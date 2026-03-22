import { streamText, tool, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import {
  initDialogueState,
  DialogueState,
  getMissingSlots,
  canSearchFlights,
  getCurrencyForOrigin,
  detectMalaysianUser,
} from "@/lib/dialogue-state";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { getCorrectPrice, validatePrice } from "@/lib/price-inference";

// 对话状态存储（简化版：基于会话ID）
// 生产环境应使用 Redis 或数据库
const sessionStates = new Map<string, DialogueState>();

// 使用官方的 OpenAI Provider 连接到 Ollama 的本地兼容接口
const ollama = createOpenAI({
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
});

function getSessionId(req: Request): string {
  // 简化版：使用 IP + User-Agent 作为会话ID
  // 生产环境应使用 JWT 或 Session Cookie
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';
  return `${ip}-${ua}`.slice(0, 64);
}

/**
 * Quick heuristic-based classification to bypass LLM latency
 */
function getFastIntent(message: string, state: DialogueState): string | null {
  const content = message.toLowerCase();
  
  // 1. Safety/Greeting Bypass
  if (/^(hi|hello|hey|你好|您好|哈喽|早上好|下午好|在吗)/i.test(content) && content.length < 15) {
    return 'general_chat';
  }
  
  // 2. Intent Keywords
  if (content.includes('航班') || content.includes('飞机') || content.includes('机票') || content.includes('flight')) {
    return 'flight_inquiry';
  }

  // 3. Stage-based Routing
  if (state.stage === 'collecting' && (content.includes('天') || content.includes('风格') || content.includes('去'))) {
    return 'travel_planning';
  }

  return null;
}

/**
 * [Workflow: Consolidator] Single LLM call for Intent + Guardrails + Slot Extraction
 */
async function analyzeRequest(messages: any[]): Promise<{ 
  intent: string; 
  safe: boolean; 
  message?: string;
  slots: { originCity?: string; destination?: string; tripDuration?: string; travelStyle?: string }
}> {
  const lastMessage = messages[messages.length - 1].content;
  if (typeof lastMessage !== 'string') return { intent: 'travel_planning', safe: true, slots: {} };

  console.log("[Optimization] Calling Super Analyzer...");
  try {
    const { text } = await generateText({
      model: ollama("qwen3.5:cloud"),
      system: `You are a travel assistant analyzer.
      Analyze the user input and respond in JSON format:
      {
        "intent": "travel_planning" | "flight_inquiry" | "general_chat" | "out_of_scope",
        "safe": boolean,
        "violation_reason": string | null,
        "extracted_slots": {
           "originCity": "3-letter airport code if mentioned",
           "destination": "City name if mentioned",
           "tripDuration": "Duration if mentioned",
           "travelStyle": "Style if mentioned"
        }
      }
      Safety: Block dangerous/illegal prompts.
      Intents: travel_planning (trip advice/slots), flight_inquiry (flights), general_chat (small talk), out_of_scope (unrelated).`,
      prompt: lastMessage,
    });
    
    const result = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return {
      intent: result.intent || 'travel_planning',
      safe: result.safe !== false,
      message: result.violation_reason || "抱歉，您的请求超出服务范围。",
      slots: result.extracted_slots || {}
    };
  } catch (e) {
    console.error("[Optimization] Analysis failed.");
    return { intent: 'travel_planning', safe: true, slots: {} };
  }
}

export async function POST(req: Request) {
  const { messages } = await req.json();

  // [Refactor: SDK Compliance] Use raw messages but shallow copy for safety
  const sanitizedMessages = messages.map((m: any) => ({ ...m }));

  const sessionId = getSessionId(req);
  let state = sessionStates.get(sessionId) || initDialogueState();
  const country = req.headers.get('x-vercel-ip-country') || 'Malaysia (MYR)';
  const currentDateTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const currentYear = new Date().getFullYear();

  // Use the legacy extractor ONLY for tool result reconciliation
  state = extractStateFromToolResults(messages, state);

  const baseSystemPrompt = buildSystemPrompt({
    state,
    currentDateTime,
    currentYear,
    userCountry: country,
  });

  // [Optimization: Hybrid Routing & Parallelization]
  const lastMsgContent = sanitizedMessages[sanitizedMessages.length - 1].content || "";
  let intent: string;
  let safety = { safe: true, message: "" };

  const fastIntent = getFastIntent(lastMsgContent, state);
  if (fastIntent) {
    console.log("[Optimization] Fast-routing matched:", fastIntent);
    intent = fastIntent;
  } else {
    const analysis = await analyzeRequest(sanitizedMessages);
    intent = analysis.intent;
    safety = { safe: analysis.safe, message: analysis.message || "" };
    
    // [Refactor: Centralized Slot Update]
    if (analysis.slots && intent !== 'out_of_scope') {
      Object.entries(analysis.slots).forEach(([k, v]) => {
        if (v && !(state.slots as any)[k]) {
          (state.slots as any)[k] = v;
          if (k === 'originCity') state.slots.currency = getCurrencyForOrigin(v);
        }
      });
    }
  }

  if (!safety.safe) {
    return new Response(JSON.stringify({ error: safety.message }), { status: 403 });
  }

  // --- Tool Definitions ---

  const ask_user_preference = tool({
    description: `当需要向用户询问偏好并期望用户在选项中做选择时调用。
【极其重要】在信息收集阶段，必须通过此工具询问用户，禁止在普通文本中再次列出选项！
【核心约束】绝对禁止在同一次回复中生成多个 ask_user_preference 调用。每次只能询问一个未确认的信息！`,
    parameters: z.object({
      question: z.string().describe('你想问用户的问题（不要包含选项），例如 "您计划在巴黎停留多少天？"'),
      options: z.array(z.string()).describe('提供给用户的具体选项数组，例如 ["3-5天", "6-8天", "一周以上"]（最多4个）'),
      slot_type: z.enum(['originCity', 'destination', 'tripDuration', 'travelStyle']).optional()
        .describe('此问题对应的槽位类型，用于状态追踪'),
    }),
  });

  const search_web = tool({
    description: `当需要查询景点开放时间、官方订票链接、最新票价或实时资讯时调用。
【重要】搜索欧洲景点票价时，请在query中包含"non-EU tourist price"或"international visitor price"，以避免返回本地居民优惠价。`,
    parameters: z.object({
      query: z.string().describe('搜索关键词，例如 "Louvre Museum non-EU tourist ticket price 2026"'),
      context: z.string().optional().describe('搜索上下文，如用户身份信息'),
    }),
    execute: async ({ query, context }: { query: string; context?: string }) => {
      console.log("[RAG] Searching:", query);
      let enhancedQuery = query;
      if (state.slots.originCity && detectMalaysianUser(state.slots.originCity)) {
        if (query.toLowerCase().includes('price') || query.toLowerCase().includes('ticket') || query.toLowerCase().includes('票价')) {
          enhancedQuery = `${query} non-EU tourist international visitor`;
        }
      }
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY as string,
          query: enhancedQuery,
          include_answer: true,
          max_results: 3
        }),
      });
      const data = (await response.json()) as any;
      const attractionMatch = query.match(/(louvre|versailles|eiffel|museum|博物馆|宫殿)/i);
      if (attractionMatch && state.slots.originCity && detectMalaysianUser(state.slots.originCity)) {
        return {
          answer: data.answer,
          results: data.results || [],
          _priceNote: `⚠️ 价格提示：用户是马来西亚游客（非EEA公民），查询到的欧洲景点票价请使用非欧盟游客价格。`
        };
      }
      return { answer: data.answer, results: data.results || [] };
    },
  } as any);

  const search_flights_serpapi = tool({
    description: `【严格限制】只有当出发城市和目的地都已确认时才能调用此工具。
取得数据后请配合 show_flight_card 展示给用户。`,
    parameters: z.object({
      departure_id: z.string().describe('起飞机场三字代码'),
      arrival_id: z.string().describe('降落机场三字代码'),
      outbound_date: z.string().describe('出发日期 YYYY-MM-DD'),
      return_date: z.string().optional().describe('返程日期 YYYY-MM-DD'),
      currency: z.string().optional().describe('货币代码'),
    }),
    execute: async ({ departure_id, arrival_id, outbound_date, return_date, currency }: any) => {
      if (!canSearchFlights(state)) {
        return { error: `航班搜索被阻止：缺少必要信息`, hint: "请先使用 ask_user_preference 收集用户信息" };
      }
      const finalCurrency = currency || getCurrencyForOrigin(state.slots.originCity);
      const params = new URLSearchParams({
        engine: "google_flights",
        departure_id, arrival_id, outbound_date, currency: finalCurrency,
        hl: "zh-CN", api_key: process.env.SERPAPI_API_KEY as string
      });
      if (return_date) { params.append("type", "1"); params.append("return_date", return_date); } 
      else { params.append("type", "2"); }

      try {
        const res = await fetch(`https://serpapi.com/search?${params.toString()}`);
        const data = (await res.json()) as any;
        if (!data.best_flights || data.best_flights.length === 0) return { error: "未找到匹配航班" };

        const best_flights = data.best_flights.slice(0, 3).map((f: any) => ({
          price: `${finalCurrency} ${f.price}`,
          airlines: f.flights.map((fl: any) => fl.airline).join(", "),
          departure: `${f.flights[0].departure_airport.id} ${f.flights[0].departure_airport.time}`,
          arrival: `${f.flights[f.flights.length-1].arrival_airport.id} ${f.flights[f.flights.length-1].arrival_airport.time}`,
          duration: `${Math.floor(f.total_duration / 60)}h ${f.total_duration % 60}m`,
        }));
        return { success: true, data: best_flights };
      } catch (e: any) { return { error: e.message }; }
    }
  } as any);

  const show_flight_card = tool({
    description: '展示航班卡片。',
    parameters: z.object({
      airline: z.string(), flightNumber: z.string(), departure: z.string(),
      arrival: z.string(), price: z.string(), duration: z.string(), bookingUrl: z.string(),
    }),
    execute: async () => ({ success: true })
  } as any);

  const show_ground_transport_card = tool({
    description: '展示陆路交通。',
    parameters: z.object({
      transportType: z.enum(['bus', 'train', 'ferry', 'driving']), fromCity: z.string(),
      toCity: z.string(), duration: z.string(), price: z.string(), tips: z.string(), bookingUrl: z.string(),
    }),
    execute: async () => ({ success: true })
  } as any);

  const confirm_slot = tool({
    description: `登记用户偏好信息。`,
    parameters: z.object({
      slot_type: z.enum(['originCity', 'destination', 'tripDuration', 'travelStyle']),
      value: z.string(),
    }),
    execute: async ({ slot_type, value }: any) => {
      return { success: true, slotType: slot_type, value };
    }
  } as any);

  // --- Routing & Tool Injection Logic ---

  let activeTools: any = {};
  let finalSystemPrompt = baseSystemPrompt;

  if (intent === 'out_of_scope') {
    finalSystemPrompt = "你是一个专业的旅游顾问。用户问了一个超出你服务范围的问题（如编程、数学、医疗）。请礼貌地拒绝，并引导用户回到旅游规划的话题上。";
  } else if (intent === 'general_chat') {
    activeTools = {}; // Only chat
    finalSystemPrompt = "你是一个亲切友好的旅游顾问，正在与用户闲聊。不需要调用工具，直接回复即可。";
  } else {
    // Basic travel tools
    activeTools = { ask_user_preference, search_web, confirm_slot, show_ground_transport_card };
    
    // [Fix: Path to Flight Search] Use state-based injection instead of intent-locking
    if (canSearchFlights(state)) {
      activeTools.search_flights_serpapi = search_flights_serpapi;
      activeTools.show_flight_card = show_flight_card;
      finalSystemPrompt += "\n【航班查询已解锁】如果用户同意或主动要求查询航班，请立即调用 search_flights_serpapi 获取实时数据。";
    }
    
    finalSystemPrompt += "\n【严格约束】收到用户的偏好选择（如来自 ask_user_preference 的结果）后，必须立即执行 confirm_slot 记录，绝不允许重复询问同一个问题！";
  }

  const result = await streamText({
    model: ollama("qwen3.5:cloud"),
    messages: sanitizedMessages,
    system: finalSystemPrompt,
    maxSteps: 10,
    maxTokens: 4096,
    tools: activeTools,
  });

  // Save final state before returning (handles analyzer's updates)
  sessionStates.set(sessionId, state);

  return result.toDataStreamResponse();
}

/**
 * 从对话历史中提取状态更新
 */
/**
 * 仅从工具调用的结果中提取状态同步
 */
function extractStateFromToolResults(messages: any[], state: DialogueState): DialogueState {
  state.confirmations = [];
  const slotNames: any = { originCity: '出发城市', destination: '目的地', tripDuration: '行程天数', travelStyle: '旅行风格' };

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolInvocations) {
      for (const inv of msg.toolInvocations) {
        if (inv.state === 'result' && (inv.toolName === 'ask_user_preference' || inv.toolName === 'confirm_slot')) {
          const val = inv.toolName === 'confirm_slot' ? inv.args?.value : (inv.result || inv.args?.value);
          const slotType = inv.args?.slot_type || inv.slot_type;
          
          if (slotType && val) {
            if (slotType === 'originCity' && typeof val === 'string' && val.includes('(')) {
                const codeMatch = val.match(/\(([A-Z]{3})\)/);
                if (codeMatch) {
                    (state.slots as any)[slotType] = codeMatch[1];
                    state.slots.currency = getCurrencyForOrigin(codeMatch[1]);
                } else { (state.slots as any)[slotType] = val; }
            } else {
              (state.slots as any)[slotType] = val;
            }
            
            const label = slotNames[slotType];
            if (label) {
              const entry = `✓ ${label}: ${val}`;
              if (!state.confirmations.includes(entry)) state.confirmations.push(entry);
            }
          }
        }
      }
    }
  }

  if (getMissingSlots(state).length === 0 && state.stage === 'collecting') {
    state.stage = 'planning';
  }
  return state;
}