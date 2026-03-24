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
  checkTravelRestrictions,
} from "@/lib/dialogue-state";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { getCorrectPrice, validatePrice } from "@/lib/price-inference";
import { RagTrace, gradeContextRelevance, gradeFactuality } from "@/lib/rag-evaluator";

import { getSession, setSession, getRedis } from "@/lib/redis";

// 移除内存存储，改用 Redis
// const sessionStates = new Map<string, DialogueState>();

// 使用官方的 OpenAI Provider 连接到本地 Ollama 控制的云端模型
const ollama = createOpenAI({
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
});

const cloudModel = ollama("qwen3.5:cloud");

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
  if (state.stage === 'collecting' && (content.includes('天') || content.includes('风格') || content.includes('去') || content.length < 10)) {
    return 'travel_planning';
  }

  // 4. Safety Guard (Fast Check)
  if (/(暴力|色情|毒品|自杀|枪支|炸药|非法|赌博|vpn|翻墙)/i.test(content)) {
    return 'out_of_scope';
  }

  // 5. Travel Restriction Check
  let origin = state.slots.originCity;
  if (!origin) {
    // Heuristic: check if user mentions Malaysia/KL in the current message
    if (/(吉隆坡|kl|kuala lumpur|malaysia|马来西亚)/i.test(content)) {
      origin = 'KUL'; 
    }
  }
  
  const restrictionError = checkTravelRestrictions(origin, content);
  if (restrictionError) {
    return 'restricted_travel';
  }

  return null;
}

/**
 * [Optimization] Message Pruning for Long-running Agentic Sessions
 * Prevents context overflow by truncating old tool result blobs and keeping only essential state.
 */
function pruneMessages(messages: any[], maxTokens = 24000): any[] {
  // 简易逻辑：如果消息数量过多，保留前2条（System/Initial User）和最近的 N 条
  if (messages.length < 15) return messages;

  const systemMsg = messages[0];
  const initialUserMsg = messages[1];
  const recentMessages = messages.slice(-12); // 保留最近 12 条记录（约 2-3 个完整的工具交互环）

  return [systemMsg, initialUserMsg, ...recentMessages];
}

// 🛑 [REMOVED] analyzeRequest 
// Now merged into getFastIntent and the main streamText call logic.

export async function POST(req: Request) {
  const { messages } = await req.json();

  // [Refactor: SDK Compliance] Use raw messages but shallow copy for safety
  const sanitizedMessages = messages.map((m: any) => ({ ...m }));

  const sessionId = getSessionId(req);
  let state = (await getSession(sessionId)) || initDialogueState();
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

  // [Optimization: Single LLM Call]
  const lastMsg = sanitizedMessages[sanitizedMessages.length - 1];
  const lastMsgContent = lastMsg.content || "";
  let intent: string;
  let safety = { safe: true, message: "" };
  let activeTools: any = {};

  const fastIntent = getFastIntent(lastMsgContent, state);
  if (fastIntent) {
    console.log("[Optimization] Fast-routing matched:", fastIntent);
    intent = fastIntent;
    if (intent === 'restricted_travel') {
      activeTools = {}; // Immediate lockdown
    }
  } else if (lastMsg.role === 'tool' && (lastMsg.toolName === 'ask_user_preference' || lastMsg.toolName === 'confirm_slot')) {
    intent = 'travel_planning';
  } else {
    // Default to main processing, moving analysis into the prompt
    intent = 'travel_planning';
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
    description: `当需要查询景点/餐厅/通票的最新资讯、营业时间、官方订票/预订链接或最新价格时调用。
【极度重要-数值拦截】对于任何涉及通行卡(Pass)或门票的数值问题，必须先调用此工具核查。
【重要】搜索欧洲景点票价时，请在query中包含"non-EU tourist price"或"international visitor price"。查询餐厅时，带上"booking url"或"TheFork"。`,
    parameters: z.object({
      query: z.string().describe('搜索关键词，例如 "Roma Pass 72 hours official price 2026"'),
      verification_target: z.enum(['TICKET_POLICY_FOR_FOREIGNERS', 'BUSINESS_OPERATING_STATUS', 'BOOKING_AND_NAVIGATION', 'NUMERICAL_ENTITY_CHECK', 'GENERAL_INFO']).optional()
        .describe('你正在核查的目标。查询票价/数值选 NUMERICAL_ENTITY_CHECK 或 TICKET_POLICY_FOR_FOREIGNERS，查是否关门选 BUSINESS_OPERATING_STATUS，提取预订链接和地图选 BOOKING_AND_NAVIGATION'),
      context: z.string().optional().describe('搜索上下文，如用户身份信息'),
    }),
    execute: async ({ query, verification_target, context }: { query: string; verification_target?: string; context?: string }) => {
      console.log("[RAG] Searching:", query, "Target:", verification_target);

      // 净化搜索词：避免塞入诱导性、假设性词汇（如 mandatory fee, 涨价）导致搜索引擎和 LLM 出现幻觉
      let enhancedQuery = query;
      if (!query.includes('2026')) enhancedQuery += ' 2026';
      if (!query.match(/official|官方/i)) enhancedQuery += ' official';

      // 仅保留中性的意图后缀，严禁加入 "fee/mandatory/tourist" 等暗示性词汇
      if (verification_target === 'BOOKING_AND_NAVIGATION') enhancedQuery += ' booking url location open status';
      if (verification_target === 'NUMERICAL_ENTITY_CHECK') enhancedQuery += ' exact price ticket';

      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY as string,
          query: enhancedQuery,
          include_answer: true,
          max_results: 3,
          days: 180 // 【Freshness Prioritization】过滤半年前的旧数据，避免票价幻觉
        }),
      });
      const data = (await response.json()) as any;

      // 添加极其严厉的反幻觉防穿透补丁
      const resultMessage = {
        answer: data.answer,
        results: data.results || [],
        recencyNote: `【关键防幻觉约束】请严格字面地基于上述返回结果回答！如果搜索结果中【没有】白纸黑字写明 2026 年针对外国游客涨价，或者只提及了过去的政策，你【必须】老实回答：“目前暂无 2026 年新政，参考当前票价为 [X]”。绝不允许为了迎合用户的提问去捏造涨价比例或莫须有的附加费！！！`
      };

      return resultMessage;
    },
  } as any);

  const search_hotels = tool({
    description: `当需要搜索、推荐酒店或查询住宿时调用。
【致命约束】必须同时提供具体的入住日期，并查询其在您出行期间的营业状态（是正常营业、停业翻新还是被征用等），切勿推荐暂时歇业的酒店。`,
    parameters: z.object({
      location: z.string().describe('搜索的目的地或区域，例如 "纽约曼哈顿 Times Square"'),
      check_in_date: z.string().describe('具体的出行入住日期，格式 YYYY-MM-DD，用于时序校验'),
      require_status: z.enum(['CONFIRMED_OPEN', 'UNKNOWN']).describe('必须填入 CONFIRMED_OPEN 以确认营业状态'),
      budget_category: z.string().optional().describe('预算类别，如"舒适型"、"奢华型"'),
    }),
    execute: async ({ location, check_in_date, require_status, budget_category }: any) => {
      console.log("[RAG/Hotel] Searching:", location, "Date:", check_in_date, "Status:", require_status);

      const query = `${location} hotel ${budget_category || ''} open status ${check_in_date.substring(0, 4)} news`;

      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY as string,
          query: query,
          include_answer: true,
          max_results: 3,
          days: 180 // 同样保持酒店资讯的新鲜度
        }),
      });
      const data = (await response.json()) as any;

      return {
        answer: data.answer,
        results: data.results || [],
        verificationNote: `重要核查：请仔细阅读上述搜索结果，确认该酒店在 ${check_in_date} 确实对公众正式营业。如果是被征用、正在翻修、计划延期开业，请**绝对禁止**向用户推荐查无开业状态的酒店！`
      };
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
          arrival: `${f.flights[f.flights.length - 1].arrival_airport.id} ${f.flights[f.flights.length - 1].arrival_airport.time}`,
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

  const show_map = tool({
    description: '展示交互式地图，标注景点、酒店或交通路线。',
    parameters: z.object({
      title: z.string().describe('地图标题'),
      center: z.object({
        lat: z.number(),
        lng: z.number(),
      }).optional().describe('地图中心点，如果不提供则根据 markers 自动计算'),
      zoom: z.number().optional().default(13),
      markers: z.array(z.object({
        lat: z.number(),
        lng: z.number(),
        label: z.string().describe('标注名称'),
        description: z.string().optional().describe('标注描述'),
      })).describe('需要在地图上标注的点'),
    }),
    execute: async () => ({ success: true })
  } as any);

  const show_hotel_carousel = tool({
    description: '展示一组酒店推荐卡片。',
    parameters: z.object({
      title: z.string().describe('推荐标题，例如 "巴黎市中心奢华酒店推荐"'),
      hotels: z.array(z.object({
        name: z.string().describe('酒店名称'),
        rating: z.number().describe('评分 (0-5)'),
        price: z.string().describe('价格范围，包含货币符号，例如 "$200 - $350"'),
        image: z.string().optional().describe('酒店图片 URL'),
        description: z.string().describe('酒店简短描述'),
        bookingUrl: z.string().describe('预订链接或详情链接'),
      })).describe('酒店列表'),
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

  let finalSystemPrompt = baseSystemPrompt;

  if (intent === 'out_of_scope') {
    finalSystemPrompt = "你是一个专业的旅游顾问。用户问了一个超出你服务范围的问题（如编程、数学、医疗）。请礼貌地拒绝，并引导用户回到旅游规划的话题上。";
  } else if (intent === 'restricted_travel') {
    activeTools = {};
    const restrictionError = checkTravelRestrictions(state.slots.originCity, lastMsgContent) || "⚠️ 该行程因护照限制或法律风险暂时无法规划。";
    finalSystemPrompt = `你是一个非常严谨负责的旅游顾问。用户请求前往一个受限目的地（如马来西亚护照持有者去以色列）。
你的任务是：
1. **立即停止所有行程规划**。
2. **给出以下严肃警告**：\n${restrictionError}\n
3. **解释原因**：说明针对该国籍持有者的法律风险或护照限制（尤其是马来西亚护照对以色列无效的情况）。
4. **禁止工具调用**：绝不调用任何航班、酒店或地图工具。
5. **引导用户**：询问用户是否需要规划其他目的地。`;
  } else if (intent === 'general_chat') {
    activeTools = {}; // Only chat
    finalSystemPrompt = "你是一个亲切友好的旅游顾问，正在与用户闲聊。不需要调用工具，直接回复即可。";
  } else {
    // 基础核心工具始终注入
    activeTools = {
      ask_user_preference,
      confirm_slot,
      show_map,
    };

    // 动态路由：判断是否为跟团游
    const isGroupTour = state.slots.travelStyle && state.slots.travelStyle.includes('跟团');

    if (isGroupTour) {
      // 跟团游：只需通用搜索即可（重点搜 Tour Package），剥夺 DIY 工具
      activeTools.search_web = search_web;
    } else {
      // 自由行：全量注入酒店、交通卡片等 DIY 工具
      activeTools.search_web = search_web;
      activeTools.search_hotels = search_hotels;
      activeTools.show_ground_transport_card = show_ground_transport_card;
      activeTools.show_hotel_carousel = show_hotel_carousel;
    }

    // [Fix: Path to Flight Search] Use state-based injection instead of intent-locking
    if (canSearchFlights(state)) {
      activeTools.search_flights_serpapi = search_flights_serpapi;
      activeTools.show_flight_card = show_flight_card;
      finalSystemPrompt += "\n【航班查询已解锁】如果用户同意或主动要求查询航班，请立即调用 search_flights_serpapi 获取实时数据。";
    }

    finalSystemPrompt += "\n【槽位提取】如果用户在当前对话中提供了新的信息（如出发城市、目的地、天数、风格），且你尚未确认该信息，必须立即调用 confirm_slot 进行登记。";
    finalSystemPrompt += "\n【严格约束】收到用户的偏好选择后，必须立即执行 confirm_slot 记录，绝不允许重复询问同一个问题！";
    finalSystemPrompt += "\n【安全防范】如果用户请求包含非法、暴力或不当内容，请礼貌拒绝并引导回旅游话题。";
  }

  // [Optimization: Context Window Management]
  const processedMessages = pruneMessages(sanitizedMessages);

  // [Agentic RAG: Pre-generation Grader & Query Rewriter]
  // Note: For a more advanced flow, we could use multiple generateText calls.
  // Here we use the system prompt to enforce self-evaluation and provide feedback via tool results.

  const result = await streamText({
    model: cloudModel,
    messages: processedMessages,
    system: finalSystemPrompt,
    maxSteps: 10,
    maxTokens: 4096,
    tools: activeTools,
    onStepFinish: async (step) => {
      // 如果这一步调用了搜索工具，我们要评分
      const searchCalls = step.toolCalls.filter(tc => tc.toolName === 'search_web' || tc.toolName === 'search_hotels');
      if (searchCalls.length > 0) {
        const results = step.toolResults.filter(tr => tr.toolName === 'search_web' || tr.toolName === 'search_hotels');
        const contexts: string[] = [];
        results.forEach((tr: any) => {
          if (tr.result?.answer) contexts.push(tr.result.answer);
          if (tr.result?.results) tr.result.results.forEach((r: any) => r.content && contexts.push(r.content));
        });

        if (contexts.length > 0) {
          const query = searchCalls[0].args.query;
          const relevance = await gradeContextRelevance(query, contexts);
          console.log(`[Agentic-RAG] Step Relevance Score: ${relevance.score} | Rationale: ${relevance.rationale}`);
          
          if (relevance.score < 0.6) {
            console.log(`[Agentic-RAG] Low relevance detected. Encouraging query rewriting...`);
            // 我们不能直接修改已生成的 toolResults，但我们可以添加一条“自省”消息到对话历史中
            // 在 AI SDK 中，我们可以通过返回特定的 toolResult 提示模型
            // 或者利用 maxSteps，模型会自动决定下一步。
            // 改进建议：在 toolResult 中加入评分反馈
            results.forEach((tr: any) => {
              if (tr.result) {
                tr.result.relevanceScore = relevance.score;
                tr.result.feedback = `【系统评分：不相关 (${relevance.score})】原因：${relevance.rationale}。请尝试重写搜索关键词（例如更具体的地点、年份或官方术语）并重新搜索，不要基于这些无效信息编造预测。`;
              }
            });
          }
        }
      }
    },
    onFinish: async ({ text, toolCalls, toolResults }) => {
      // 最终状态保存
      await setSession(sessionId, state);

      // [Agentic RAG: Post-generation Factuality Guard]
      if (text) {
        const actualUserQuery = messages.filter((m: any) => m.role === 'user').slice(-1)[0]?.content || lastMsgContent;
        const factuality = await gradeFactuality(actualUserQuery, text);
        if (factuality.score < 0.5) {
          console.warn(`[Agentic-RAG] CRITICAL: Hallucination detected in final answer! Score: ${factuality.score}`);
          // 在流式输出中，我们已经把内容发给用户了。
          // 真正的拦截需要在 streamText 之前完成。
          // 这里我们记录这个严重错误用于回归测试。
        }
      }

      // [RAG Evaluation] Capture trace for LLM-as-a-Judge evaluation ...
      if (process.env.ENABLE_RAG_EVAL === 'true') {
        try {
          const retrievedContexts: string[] = [];
          const traceToolCalls: RagTrace['toolCalls'] = [];

          if (messages && Array.isArray(messages)) {
            for (const msg of messages) {
              if (msg.role === 'assistant' && msg.toolInvocations) {
                for (const inv of msg.toolInvocations) {
                  if (inv.state === 'result') {
                    const resultData = inv.result;
                    if (resultData?.answer) retrievedContexts.push(resultData.answer);
                    if (resultData?.results && Array.isArray(resultData.results)) {
                      for (const r of resultData.results) {
                        if (r.content) retrievedContexts.push(r.content.slice(0, 500));
                      }
                    }
                    traceToolCalls.push({
                      toolName: inv.toolName,
                      args: inv.args || {},
                      result: typeof inv.result === 'object' ? JSON.stringify(inv.result).slice(0, 300) : inv.result,
                    });
                  }
                }
              }
            }
          }

          // Also capture any tool results from the CURRENT finish (if not already in messages)
          if (toolResults && Array.isArray(toolResults)) {
            for (const tr of toolResults as any[]) {
              // Only add if not already captured from toolInvocations (common in AI SDK)
              if (!traceToolCalls.some(tc => tc.toolName === tr.toolName && JSON.stringify(tc.args) === JSON.stringify(tr.args))) {
                const resultData = tr.result;
                if (resultData?.answer) retrievedContexts.push(resultData.answer);
                if (resultData?.results && Array.isArray(resultData.results)) {
                  for (const r of resultData.results) {
                    if (r.content) retrievedContexts.push(r.content.slice(0, 500));
                  }
                }
                traceToolCalls.push({
                  toolName: tr.toolName,
                  args: tr.args || {},
                  result: typeof tr.result === 'object' ? JSON.stringify(tr.result).slice(0, 300) : tr.result,
                });
              }
            }
          }

          // Find the last user message for the query (skipping tool results/assistant replies)
          const actualUserQuery = messages
            .filter((m: any) => m.role === 'user')
            .slice(-1)[0]?.content || lastMsgContent;

          const ragTrace: RagTrace = {
            userQuery: actualUserQuery,
            retrievedContexts,
            llmAnswer: text || '',
            toolCalls: traceToolCalls,
            timestamp: new Date().toISOString(),
            sessionId,
          };

          // Fire-and-forget: store trace to Redis with 24h TTL
          const redis = getRedis();
          const traceKey = `eval:trace:${sessionId}:${Date.now()}`;
          await redis.set(traceKey, JSON.stringify(ragTrace), 'EX', 86400);
          console.log(`[RAG-Eval] Trace captured: ${traceKey}`);
        } catch (evalErr: any) {
          console.warn('[RAG-Eval] Trace capture failed (non-blocking):', evalErr.message);
        }
      }
    }
  });

  // 在返回响应前，确保状态已初步同步
  await setSession(sessionId, state);

  return result.toDataStreamResponse();
}

/**
 * 从对话历史中提取状态更新
 */
/**
 * 优化：增量同步状态，仅处理新消息
 */
function extractStateFromToolResults(messages: any[], state: DialogueState): DialogueState {
  const slotNames: any = { originCity: '出发城市', destination: '目的地', tripDuration: '行程天数', travelStyle: '旅行风格' };

  // 只处理 lastProcessedIndex 之后的消息
  const newMessages = messages.slice(state.lastProcessedIndex);

  for (const msg of newMessages) {
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

  // 更新处理索引
  state.lastProcessedIndex = messages.length;

  if (getMissingSlots(state).length === 0 && state.stage === 'collecting') {
    state.stage = 'planning';
  }
  return state;
}