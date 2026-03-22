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
 * [Workflow: Consolidator] Single LLM call for Intent + Guardrails
 */
async function analyzeRequest(messages: any[]): Promise<{ intent: string; safe: boolean; message?: string }> {
  const lastMessage = messages[messages.length - 1].content;
  if (typeof lastMessage !== 'string') return { intent: 'travel_planning', safe: true };

  console.log("[Optimization] Calling single LLM for Analysis...");
  try {
    const { text } = await generateText({
      model: ollama("qwen3.5:cloud"),
      system: `You are a request analyzer for a travel assistant.
      Analyze the user input and respond in JSON format:
      {
        "intent": "travel_planning" | "flight_inquiry" | "general_chat" | "out_of_scope",
        "safe": boolean,
        "violation_reason": string | null
      }
      Safety guidelines: Block dangerous, illegal, or malicious prompts.
      Intent guidelines: 
      - travel_planning: trip advice, attractions, slot-filling.
      - flight_inquiry: flight search/info.
      - general_chat: small talk.
      - out_of_scope: unrelated topics.`,
      prompt: lastMessage,
    });
    
    const result = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return {
      intent: result.intent || 'travel_planning',
      safe: result.safe !== false,
      message: result.violation_reason || "抱歉，您的请求超出服务范围。"
    };
  } catch (e) {
    console.error("[Optimization] Analysis failed, falling back to safe default.");
    return { intent: 'travel_planning', safe: true };
  }
}

export async function POST(req: Request) {
  const { messages } = await req.json();

  // 提取原始数据并转换为对 LLM 友好的格式
  const sanitizedMessages: any[] = [];
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolInvocations) {
      const newMsg = { ...m };
      const askPrefTools = newMsg.toolInvocations.filter((t: any) => t.toolName === 'ask_user_preference' && t.state === 'result');
      const otherTools = newMsg.toolInvocations.filter((t: any) => !(t.toolName === 'ask_user_preference' && t.state === 'result'));
      
      newMsg.toolInvocations = otherTools;
      if (newMsg.toolInvocations.length === 0) delete newMsg.toolInvocations;
      if (!newMsg.content && (!newMsg.toolInvocations || newMsg.toolInvocations.length === 0)) {
        newMsg.content = "让我确认一下您的偏好和信息。";
      }
      if (newMsg.content || newMsg.toolInvocations) sanitizedMessages.push(newMsg);
      
      if (askPrefTools.length > 0) {
        const answers = askPrefTools.map((t: any) => `我选择的内容是：${t.result}`).join('\n');
        sanitizedMessages.push({ role: 'user', content: answers });
      }
    } else {
      sanitizedMessages.push(m);
    }
  }

  const sessionId = getSessionId(req);
  let state = sessionStates.get(sessionId) || initDialogueState();
  const country = req.headers.get('x-vercel-ip-country') || 'Malaysia (MYR)';
  const currentDateTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const currentYear = new Date().getFullYear();

  state = extractStateFromHistory(messages, state);

  const baseSystemPrompt = buildSystemPrompt({
    state,
    currentDateTime,
    currentYear,
    userCountry: country,
  });

  // [Optimization: Hybrid Routing & Parallelization]
  const lastMsgContent = sanitizedMessages[sanitizedMessages.length - 1].content;
  let intent: string;
  let safety = { safe: true, message: "" };

  const fastIntent = getFastIntent(lastMsgContent, state);
  if (fastIntent) {
    console.log("[Optimization] Fast-routing matched:", fastIntent);
    intent = fastIntent;
  } else {
    // Only call LLM for complex/unclear inputs
    const analysis = await analyzeRequest(sanitizedMessages);
    intent = analysis.intent;
    safety = { safe: analysis.safe, message: analysis.message || "" };
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
        state.stage = 'planning';
        sessionStates.set(sessionId, state);
        return { success: true, data: best_flights, _stateUpdate: { stage: 'planning' } };
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
      (state.slots as any)[slot_type] = value;
      const slotNames: any = { originCity: '出发城市', destination: '目的地', tripDuration: '行程天数', travelStyle: '旅行风格' };
      state.confirmations.push(`✓ ${slotNames[slot_type]}: ${value}`);
      if (getMissingSlots(state).length === 0) state.stage = 'planning';
      sessionStates.set(sessionId, state);
      return { success: true, slotType: slot_type, value, currentState: state };
    }
  } as any);

  // --- Routing Logic ---

  let activeTools: any = {};
  let finalSystemPrompt = baseSystemPrompt;

  if (intent === 'travel_planning') {
    activeTools = { ask_user_preference, search_web, confirm_slot, show_ground_transport_card };
  } else if (intent === 'flight_inquiry') {
    activeTools = { search_flights_serpapi, show_flight_card };
    finalSystemPrompt += "\n【重点】用户当前正在咨询航班，请优先通过 search_flights_serpapi 获取实时数据。";
  } else if (intent === 'out_of_scope') {
    finalSystemPrompt = "你是一个专业的旅游顾问。用户问了一个超出你服务范围的问题（如编程、数学、医疗）。请礼貌地拒绝，并引导用户回到旅游规划的话题上。";
  } else {
    activeTools = {}; // general_chat
    finalSystemPrompt = "你是一个亲切友好的旅游顾问，正在与用户闲聊。不需要调用工具，直接回复即可。";
  }

  const result = await streamText({
    model: ollama("qwen3.5:cloud"),
    messages: sanitizedMessages,
    system: finalSystemPrompt,
    maxSteps: 10,
    maxTokens: 4096,
    tools: activeTools,
  });

  return result.toDataStreamResponse();
}

/**
 * 从对话历史中提取状态更新
 */
function extractStateFromHistory(messages: any[], state: DialogueState): DialogueState {
  // 遍历消息历史，检测用户选择与工具结果
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolInvocations) {
      for (const inv of msg.toolInvocations) {
        if (inv.state === 'result' && (inv.toolName === 'ask_user_preference' || inv.toolName === 'confirm_slot')) {
          const val = inv.toolName === 'confirm_slot' ? inv.args?.value : (inv.result || inv.args?.value);
          const slotType = inv.args?.slot_type || inv.slot_type;
          
          if (slotType && val) {
            // Update the slot directly from the tool result
            if (slotType === 'originCity' && typeof val === 'string' && val.includes('(')) {
                const codeMatch = val.match(/\(([A-Z]{3})\)/);
                if (codeMatch) {
                    (state.slots as any)[slotType] = codeMatch[1];
                    state.slots.currency = getCurrencyForOrigin(codeMatch[1]);
                } else {
                    (state.slots as any)[slotType] = val;
                }
            } else if (slotType === 'originCity' && typeof val === 'string') {
                const airportPatterns: Record<string, RegExp> = {
                  'KUL': /吉隆坡|kul|kuala lumpur/i,
                  'PEN': /槟城|pen|penang/i,
                  'JHB': /新山|jhb|johor bahru|jb(?!k)/i,
                  'KCH': /古晋|kch|kuching/i,
                  'BKI': /亚庇|bki|kota kinabalu/i,
                  'SIN': /新加坡|sin|singapore/i,
                };
                let matched = false;
                for (const [code, pattern] of Object.entries(airportPatterns)) {
                  if (pattern.test(val)) {
                    (state.slots as any)[slotType] = code;
                    state.slots.currency = getCurrencyForOrigin(code);
                    matched = true;
                    break;
                  }
                }
                if (!matched) (state.slots as any)[slotType] = val;
            } else {
              (state.slots as any)[slotType] = val;
            }
          }
        }
      }
    }

    if (msg.role !== 'user') continue;

    const content = msg.content?.toLowerCase() || '';

    // 出发城市检测
    if (!state.slots.originCity) {
      const airportPatterns: Record<string, RegExp> = {
        'KUL': /吉隆坡|kul|kuala lumpur/i,
        'PEN': /槟城|pen|penang/i,
        'JHB': /新山|jhb|johor bahru|jb(?!k)/i,
        'KCH': /古晋|kch|kuching/i,
        'BKI': /亚庇|bki|kota kinabalu/i,
        'SIN': /新加坡|sin|singapore/i,
        'PEK': /北京|pek|beijing/i,
        'PVG': /上海|pvg|shanghai/i,
        'CAN': /广州|can|guangzhou/i,
        'SZX': /深圳|szx|shenzhen/i,
        'HKG': /香港|hkg|hong kong/i,
      };

      for (const [code, pattern] of Object.entries(airportPatterns)) {
        if (pattern.test(content)) {
          state.slots.originCity = code;
          state.slots.currency = getCurrencyForOrigin(code);
          break;
        }
      }
    }

    // 目的地检测
    if (!state.slots.destination) {
      const destPatterns: Record<string, string> = {
        '巴黎': 'Paris',
        '法国': 'Paris',
        'Paris': 'Paris',
        '伦敦': 'London',
        '英国': 'London',
        '罗马': 'Rome',
        '意大利': 'Rome',
        '柏林': 'Berlin',
        '德国': 'Berlin',
        '东京': 'Tokyo',
        '日本': 'Tokyo',
        '首尔': 'Seoul',
        '韩国': 'Seoul',
        '曼谷': 'Bangkok',
        '泰国': 'Bangkok',
        '新加坡': 'Singapore',
      };

      for (const [keyword, dest] of Object.entries(destPatterns)) {
        if (content.includes(keyword)) {
          state.slots.destination = dest;
          break;
        }
      }
    }

    // 行程天数检测
    if (!state.slots.tripDuration) {
      const durationPatterns = [
        /(\d+)\s*[-~到]\s*(\d+)\s*天/,
        /(\d+)\s*天/,
        /一周|7天/,
        /两周|14天/,
      ];

      for (const pattern of durationPatterns) {
        if (pattern.test(content)) {
          state.slots.tripDuration = content.match(pattern)?.[0] || content;
          break;
        }
      }

      // 选项匹配
      const durationOptions = ['3-5天', '6-8天', '9-12天', '两周以上'];
      for (const opt of durationOptions) {
        if (content.includes(opt)) {
          state.slots.tripDuration = opt;
          break;
        }
      }
    }

    // 旅行风格检测
    if (!state.slots.travelStyle) {
      const styleKeywords: Record<string, string> = {
        '文化': '文化历史探索',
        '历史': '文化历史探索',
        '博物馆': '文化历史探索',
        '美食': '美食体验',
        '购物': '购物休闲',
        '艺术': '艺术博物馆',
      };

      for (const [keyword, style] of Object.entries(styleKeywords)) {
        if (content.includes(keyword)) {
          state.slots.travelStyle = style;
          break;
        }
      }
    }
  }

  // 更新阶段
  if (getMissingSlots(state).length === 0 && state.stage === 'collecting') {
    state.stage = 'planning';
  }

  return state;
}