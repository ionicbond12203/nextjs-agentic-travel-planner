import { streamText, tool } from "ai";
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

export async function POST(req: Request) {
  const { messages } = await req.json();

  // 提取原始数据并转换为对 LLM 友好的格式，主要是绕过 Ollama 对 role: 'tool' 的解析问题
  const sanitizedMessages: any[] = [];
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolInvocations) {
      const newMsg = { ...m };
      
      // 我们只针对 ask_user_preference 这种在客户端执行、会打断对话流的工具进行重写
      const askPrefTools = newMsg.toolInvocations.filter((t: any) => t.toolName === 'ask_user_preference' && t.state === 'result');
      const otherTools = newMsg.toolInvocations.filter((t: any) => !(t.toolName === 'ask_user_preference' && t.state === 'result'));
      
      // 保留处理过的部分以避免LLM丢失查询结果数据（如机票、景点）。只移除 ask_user_preference 结果
      newMsg.toolInvocations = otherTools;
      
      if (newMsg.toolInvocations.length === 0) {
        delete newMsg.toolInvocations;
      }
      
      if (!newMsg.content && (!newMsg.toolInvocations || newMsg.toolInvocations.length === 0)) {
        newMsg.content = "让我确认一下您的偏好和信息。";
      }
      
      // 只加入 assistant 消息
      if (newMsg.content || newMsg.toolInvocations) {
        sanitizedMessages.push(newMsg);
      }
      
      // 如果有问答结果，作为 user message 随后追加
      if (askPrefTools.length > 0) {
        const answers = askPrefTools.map((t: any) => `我选择的内容是：${t.result}`).join('\n');
        
        sanitizedMessages.push({
          role: 'user',
          content: answers
        });
      }
    } else {
      sanitizedMessages.push(m);
    }
  }

  // 获取或创建会话状态
  const sessionId = getSessionId(req);
  let state = sessionStates.get(sessionId) || initDialogueState();

  // 注入环境上下文
  const country = req.headers.get('x-vercel-ip-country') || 'Malaysia (MYR)';
  const currentDateTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const currentYear = new Date().getFullYear();

  // 从对话历史中提取状态更新
  state = extractStateFromHistory(messages, state);

  // 构建动态系统提示
  const systemPrompt = buildSystemPrompt({
    state,
    currentDateTime,
    currentYear,
    userCountry: country,
  });

  // 检查是否允许调用航班API
  const allowFlightSearch = canSearchFlights(state);

  const result = await streamText({
    model: ollama("qwen3.5:cloud"),
    messages: sanitizedMessages,
    system: systemPrompt,
    //限制最大步数防止无限循环重复，允许充足迭代
    maxSteps: 10,
    //设置足够的最大生成长度，防止回答中途截断
    maxTokens: 4096,
    tools: {
      // 收集用户偏好（核心工具）
      ask_user_preference: tool({
        description: `当需要向用户询问偏好并期望用户在选项中做选择时调用。
【极其重要】在信息收集阶段，必须通过此工具询问用户，禁止在普通文本中再次列出选项！
【核心约束】绝对禁止在同一次回复中生成多个 ask_user_preference 调用。每次只能询问一个未确认的信息！`,
        parameters: z.object({
          question: z.string().describe('你想问用户的问题（不要包含选项），例如 "您计划在巴黎停留多少天？"'),
          options: z.array(z.string()).describe('提供给用户的具体选项数组，例如 ["3-5天", "6-8天", "一周以上"]（最多4个）'),
          slot_type: z.enum(['originCity', 'destination', 'tripDuration', 'travelStyle']).optional()
            .describe('此问题对应的槽位类型，用于状态追踪'),
        }),
      }),

      // 网络搜索（带价格推理）
      search_web: tool({
        description: `当需要查询景点开放时间、官方订票链接、最新票价或实时资讯时调用。
【重要】搜索欧洲景点票价时，请在query中包含"non-EU tourist price"或"international visitor price"，
以避免返回本地居民优惠价。`,
        parameters: z.object({
          query: z.string().describe('搜索关键词，例如 "Louvre Museum non-EU tourist ticket price 2026"'),
          context: z.string().optional().describe('搜索上下文，如用户身份信息'),
        }),
        execute: async ({ query, context }: { query: string; context?: string }) => {
          console.log("[RAG] Searching:", query);

          // 如果是票价查询，注入价格上下文
          let enhancedQuery = query;
          if (state.slots.originCity && detectMalaysianUser(state.slots.originCity)) {
            // 为马来西亚用户增强查询
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
              include_raw_content: false,
              include_domains: [],
              max_results: 3
            }),
          });
          const data = (await response.json()) as any;

          // 价格验证（如果检测到景点名称）
          const attractionMatch = query.match(/(louvre|versailles|eiffel|museum|博物馆|宫殿)/i);
          if (attractionMatch && state.slots.originCity) {
            const isMalaysian = detectMalaysianUser(state.slots.originCity);
            if (isMalaysian) {
              return {
                answer: data.answer,
                results: data.results || [],
                _priceNote: `⚠️ 价格提示：用户是马来西亚游客（非EEA公民），查询到的欧洲景点票价请使用非欧盟游客价格。`
              };
            }
          }

          return {
            answer: data.answer,
            results: data.results || []
          };
        },
      } as any),

      // 航班搜索（带状态检查）
      search_flights_serpapi: tool({
        description: `【严格限制】只有当出发城市和目的地都已确认时才能调用此工具。
调用前必须确认：originCity=${state.slots.originCity || '未确认'}, destination=${state.slots.destination || '未确认'}
取得数据后请配合 show_flight_card 展示给用户。`,
        parameters: z.object({
          departure_id: z.string().describe('起飞机场三字代码，例如吉隆坡 "KUL"'),
          arrival_id: z.string().describe('降落机场三字代码，例如巴黎 "CDG"'),
          outbound_date: z.string().describe('出发日期，格式 YYYY-MM-DD。若用户未指定具体日期，请默认填入两周后的日期。'),
          return_date: z.string().optional().describe('返程日期，格式 YYYY-MM-DD，单程则不填'),
          currency: z.string().optional().describe('查询货币代码，如 "MYR", "USD"'),
        }),
        execute: async ({ departure_id, arrival_id, outbound_date, return_date, currency }: any) => {
          // 状态检查：是否允许调用
          if (!canSearchFlights(state)) {
            const missing = getMissingSlots(state);
            return {
              error: `航班搜索被阻止：缺少必要信息 - ${missing.join(', ')}`,
              hint: "请先使用 ask_user_preference 收集用户信息"
            };
          }

          // 货币自动推断
          const finalCurrency = currency || getCurrencyForOrigin(state.slots.originCity);

          console.log(`[Flight] Searching: ${departure_id} -> ${arrival_id} on ${outbound_date} (${finalCurrency})`);

          const params = new URLSearchParams({
            engine: "google_flights",
            departure_id,
            arrival_id,
            outbound_date,
            currency: finalCurrency,
            hl: "zh-CN",
            api_key: process.env.SERPAPI_API_KEY as string
          });

          if (return_date) {
            params.append("type", "1");
            params.append("return_date", return_date);
          } else {
            params.append("type", "2");
          }

          try {
            const res = await fetch(`https://serpapi.com/search?${params.toString()}`);
            const data = (await res.json()) as any;

            if (!data.best_flights || data.best_flights.length === 0) {
              return { error: "未找到该日期的匹配航班，请尝试其他出入境日期或机场枢纽。" };
            }

            // 精简数据
            const best_flights = data.best_flights.slice(0, 3).map((f: any) => {
              const depTime = f.flights[0].departure_airport.time?.split(" ")[1] || f.flights[0].departure_airport.time;
              const arrTime = f.flights[f.flights.length-1].arrival_airport.time?.split(" ")[1] || f.flights[f.flights.length-1].arrival_airport.time;
              return {
                price: `${finalCurrency} ${f.price}`,
                airlines: f.flights.map((fl: any) => fl.airline).join(", "),
                flightNumbers: f.flights.map((fl: any) => fl.flight_number).join(", "),
                departure: `${f.flights[0].departure_airport.id} ${depTime}`,
                arrival: `${f.flights[f.flights.length-1].arrival_airport.id} ${arrTime}`,
                total_duration: `${Math.floor(f.total_duration / 60)}h ${f.total_duration % 60}m`,
                layovers: f.layovers ? f.layovers.map((l: any) => l.name).join(", ") : "直飞"
              };
            });

            // 更新状态：已执行航班搜索
            state.stage = 'planning';
            sessionStates.set(sessionId, state);

            return {
              success: true,
              data: best_flights,
              note: "已获取到航班真实数据！请用此数据调用 show_flight_card 渲染推荐。",
              _stateUpdate: { stage: 'planning' }
            };
          } catch (e: any) {
            return { error: e.message };
          }
        }
      } as any),

      // 航班卡片展示
      show_flight_card: tool({
        description: '当找到真实航班信息并向用户推荐时必须调用此工具。前端将渲染精美卡片。',
        parameters: z.object({
          airline: z.string().describe("航空公司名称，例如 'Turkish Airlines'"),
          flightNumber: z.string().describe("航班号，如 'TK 123'，或概括填 '转机'"),
          departure: z.string().describe("起飞城市及时间：例如 '吉隆坡 10:00'"),
          arrival: z.string().describe("降落城市及时间：例如 '巴黎 18:00'"),
          price: z.string().describe("价格估算（带货币），例如 'MYR 2,500'"),
          duration: z.string().describe("总飞行及转机耗时，例如 '14h 30m'"),
          bookingUrl: z.string().describe("官方或OTA订票链接，没有填 '#'"),
        }),
        execute: async () => {
          return { success: true, message: "Flight UI rendered" };
        }
      } as any),

      // 陆路交通卡片
      show_ground_transport_card: tool({
        description: '当出发地与目的地距离较近（<300km）时调用此工具展示陆路交通。',
        parameters: z.object({
          transportType: z.enum(['bus', 'train', 'ferry', 'driving']).describe("交通类型"),
          fromCity: z.string().describe("出发城市"),
          toCity: z.string().describe("目的地城市"),
          duration: z.string().describe("预计耗时"),
          price: z.string().describe("价格范围"),
          tips: z.string().describe("出行小贴士"),
          bookingUrl: z.string().describe("购票链接，没有填 '#'"),
        }),
        execute: async () => {
          return { success: true, message: "Ground transport UI rendered" };
        }
      } as any),

      // 确认槽位（用于用户选择后更新状态）
      confirm_slot: tool({
        description: `当用户在对话中提供了明确的偏好信息（如出发地、目的地、天数、风格）后，必须调用此工具将信息登记到后台系统中。
【注意】登记成功后，系统会推进状态，你可以再调用 ask_user_preference 询问下一个缺失的信息。可以伴随一句简短的反馈。`,
        parameters: z.object({
          slot_type: z.enum(['originCity', 'destination', 'tripDuration', 'travelStyle']),
          value: z.string().describe('用户选择的值'),
        }),
        execute: async ({ slot_type, value }: any) => {
          // 更新状态
          (state.slots as any)[slot_type] = value;

          // 记录确认历史
          const slotNames: Record<string, string> = {
            originCity: '出发城市',
            destination: '目的地',
            tripDuration: '行程天数',
            travelStyle: '旅行风格',
          };
          state.confirmations.push(`✓ ${slotNames[slot_type]}: ${value}`);

          // 检查是否可以进入下一阶段
          if (getMissingSlots(state).length === 0) {
            state.stage = 'planning';
          }

          sessionStates.set(sessionId, state);
          console.log(`[DST] Slot confirmed: ${slot_type} = ${value}, stage = ${state.stage}`);

          return { success: true, slotType: slot_type, value, currentState: state };
        }
      } as any),
    },
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