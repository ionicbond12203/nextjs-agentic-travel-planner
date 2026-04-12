import { streamText, tool, generateText, StreamData } from "ai";
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
  extractStateFromUserMessages,
} from "@/lib/dialogue-state";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { getCorrectPrice, validatePrice } from "@/lib/price-inference";
import { RagTrace, gradeContextRelevance, gradeFactuality } from "@/lib/rag-evaluator";
import { getSession, setSession, getRedis } from "@/lib/redis";

const ollama = createOpenAI({
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
});

const cloudModel = ollama("gemma4:31b-cloud");

function getSessionId(req: Request): string {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';
  return `${ip}-${ua}`.slice(0, 64);
}

async function getOrchestratorIntent(messages: any[], state: DialogueState, model: any): Promise<'FLIGHT_AGENT' | 'HOTEL_AGENT' | 'PLANNER_AGENT' | 'GENERAL_CHAT' | 'OUT_OF_SCOPE' | 'RESTRICTED'> {
  const lastMsg = messages[messages.length - 1];
  const content = lastMsg.content || "";

  if (/(暴力|色情|毒品|自杀|枪支|炸药|非法|赌博|vpn|翻墙)/i.test(content)) return 'OUT_OF_SCOPE';
  if (/^(hi|hello|hey|你好|您好|哈喽|早上好|下午好|在吗)/i.test(content) && content.length < 15) return 'GENERAL_CHAT';

  const restrictionError = checkTravelRestrictions(state.slots.originCity || 'KUL', content);
  if (restrictionError) return 'RESTRICTED';

  const system = `You are an Orchestrator for a travel booking swarm.
Your job is to classify the user's latest message into one of the following Agent Roles:
- FLIGHT_AGENT: User explicitly wants to search or book flights, airplanes, tickets.
- HOTEL_AGENT: User explicitly wants to search or book hotels, accommodations, places to stay.
- PLANNER_AGENT: User is providing preferences, asking general travel questions, or asking about ground transport/maps.

Only output the exact ROLE string, nothing else.`;

  try {
    const { text } = await generateText({
      model,
      system,
      prompt: content,
      maxTokens: 10,
    });
    const result = text.trim().toUpperCase() as any;
    if (['FLIGHT_AGENT', 'HOTEL_AGENT', 'PLANNER_AGENT'].includes(result)) return result;
    return 'PLANNER_AGENT';
  } catch (e) {
    if (content.includes('航班') || content.includes('飞机') || content.includes('机票') || content.includes('flight')) return 'FLIGHT_AGENT';
    if (content.includes('酒店') || content.includes('住宿') || content.includes('饭店') || content.includes('hotel')) return 'HOTEL_AGENT';
    return 'PLANNER_AGENT';
  }
}

async function compactContext(messages: any[]): Promise<any[]> {
  if (messages.length < 15) return messages;
  const systemMsg = messages[0];
  const initialUserMsg = messages[1];

  // Cut out the middle messages for summarization. Keep last 7 messages intact.
  const recentMessages = messages.slice(-7);
  const oldMessages = messages.slice(2, -7);

  const chatLog = oldMessages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');

  const { text: summary } = await generateText({
    model: cloudModel,
    system: "You are a context compression engine for a travel planning AI. Summarize the following chat log to extract all travel constraints, locations, preferences, budgets, and discussed itineraries. Keep it extremely concise but do not lose facts. Always extract confirmed numbers and locations.",
    prompt: chatLog,
  });

  const compactMsg = { role: 'system', content: `[COMPACTED_MEMORY] Summary of earlier conversation:\n${summary}` };
  return [systemMsg, initialUserMsg, compactMsg, ...recentMessages];
}

function syncDialogueState(messages: any[], state: DialogueState): DialogueState {
  const slotNames: any = { originCity: '出发城市', destination: '目的地', tripDuration: '行程天数', travelStyle: '旅行风格' };
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
  state = extractStateFromUserMessages(newMessages, state);
  state.lastProcessedIndex = messages.length;
  if (getMissingSlots(state).length === 0 && state.stage === 'collecting') {
    state.stage = 'planning';
  }
  return state;
}

export async function POST(req: Request) {
  const { id = '', messages, language = 'en' } = await req.json();
  const sanitizedMessages = messages.map((m: any) => ({ ...m }));

  // Use user IP + Chat ID (if provided) to isolate session, or fallback to simple IP
  const baseSessionId = getSessionId(req);
  const sessionId = id ? `${baseSessionId}-${id}` : baseSessionId;

  let state = (await getSession(sessionId)) || initDialogueState();

  // Reset dialogue memory if this is the very first message of the chat
  if (sanitizedMessages.length <= 1) {
    state = initDialogueState();
  }

  const country = req.headers.get('x-vercel-ip-country') || 'Malaysia (MYR)';
  const currentDateTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const currentYear = new Date().getFullYear();

  state = syncDialogueState(sanitizedMessages, state);

  let intent = await getOrchestratorIntent(sanitizedMessages, state, cloudModel);
  let agentRole: any = ['FLIGHT_AGENT', 'HOTEL_AGENT', 'PLANNER_AGENT', 'GENERAL_CHAT'].includes(intent) ? intent : 'PLANNER_AGENT';

  const baseSystemPrompt = buildSystemPrompt({
    state,
    currentDateTime,
    currentYear,
    userCountry: country,
    language: language as 'en' | 'zh',
    agentRole: agentRole,
  });

  const lastMsg = sanitizedMessages[sanitizedMessages.length - 1];
  const lastMsgContent = lastMsg.content || "";
  let activeTools: any = {};

  // --- Tool Definitions ---
  const ask_user_preference = tool({
    description: `当需要向用户询问偏好并期望用户在选项中做选择时调用。`,
    parameters: z.object({
      question: z.string().describe('你想问用户的问题'),
      options: z.array(z.string()).describe('提供给用户的具体选项'),
      slot_type: z.enum(['originCity', 'destination', 'tripDuration', 'travelStyle']).optional(),
    }),
  });

  const confirm_slot = tool({
    description: `登记槽位。`,
    parameters: z.object({
      slot_type: z.enum(['originCity', 'destination', 'tripDuration', 'travelStyle']),
      value: z.string(),
    }),
    execute: async ({ slot_type, value }: any) => ({ success: true, slotType: slot_type, value })
  } as any);

  const search_web = tool({
    description: `查询资讯、营业时间、票价等。`,
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      verification_target: z.enum(['TICKET_POLICY_FOR_FOREIGNERS', 'BUSINESS_OPERATING_STATUS', 'BOOKING_AND_NAVIGATION', 'NUMERICAL_ENTITY_CHECK', 'GENERAL_INFO']).optional(),
      context: z.string().optional(),
    }),
    execute: async ({ query }: any) => {
      let enhancedQuery = query;
      if (!query.includes('2026')) enhancedQuery += ' 2026';
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY as string,
          query: enhancedQuery,
          include_answer: true,
          max_results: 3,
        }),
      });
      const data = (await response.json()) as any;
      return { answer: data.answer, results: data.results || [] };
    },
  } as any);

  const search_hotels = tool({
    description: `搜酒店。`,
    parameters: z.object({
      location: z.string(),
      check_in_date: z.string(),
      require_status: z.enum(['CONFIRMED_OPEN', 'UNKNOWN']),
      budget_category: z.string().optional(),
    }),
    execute: async ({ location, budget_category }: any) => {
      const query = `${location} hotel ${budget_category || ''} 2026`;
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY as string,
          query: query,
          include_answer: true,
          max_results: 3,
        }),
      });
      const data = (await response.json()) as any;
      return { answer: data.answer, results: data.results || [] };
    },
  } as any);

  const search_flights_serpapi = tool({
    description: `搜航班。`,
    parameters: z.object({
      departure_id: z.string(),
      arrival_id: z.string(),
      outbound_date: z.string(),
      return_date: z.string().optional(),
      currency: z.string().optional(),
    }),
    execute: async ({ departure_id, arrival_id, outbound_date, return_date, currency }: any) => {
      const finalCurrency = currency || getCurrencyForOrigin(state.slots.originCity);
      const params = new URLSearchParams({
        engine: "google_flights",
        departure_id, arrival_id, outbound_date,
        currency: finalCurrency, hl: "zh-CN",
        api_key: process.env.SERPAPI_API_KEY as string
      });
      if (return_date) { params.append("type", "1"); params.append("return_date", return_date); }
      else params.append("type", "2");

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
    description: '展示航班。',
    parameters: z.object({
      airline: z.string(), flightNumber: z.string(), departure: z.string(),
      arrival: z.string(), price: z.string(), duration: z.string(), bookingUrl: z.string(),
    }),
    execute: async () => ({ success: true })
  } as any);

  const show_ground_transport_card = tool({
    description: '展示陆路。',
    parameters: z.object({
      transportType: z.enum(['bus', 'train', 'ferry', 'driving']), fromCity: z.string(),
      toCity: z.string(), duration: z.string(), price: z.string(), tips: z.string(), bookingUrl: z.string(),
    }),
    execute: async () => ({ success: true })
  } as any);

  const show_map = tool({
    description: '展示地图。',
    parameters: z.object({
      title: z.string(), center: z.object({ lat: z.number(), lng: z.number() }).optional(),
      zoom: z.number().optional().default(13), markers: z.array(z.any()),
    }),
    execute: async () => ({ success: true })
  } as any);

  const search_place_coordinates = tool({
    description: '搜索地点的经纬度坐标（lat/lng）。在调用 show_map 前，如果缺少准确坐标，必须先调用此工具。',
    parameters: z.object({
      address: z.string().describe('详细地址或地标名称，如 "东京铁塔" 或 "Eiffel Tower"'),
    }),
    execute: async ({ address }: any) => {
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (!apiKey) return { error: "Missing Google Maps API Key" };
      try {
        const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`);
        const data = await res.json();
        if (data.status === 'OK' && data.results.length > 0) {
          const location = data.results[0].geometry.location;
          return { success: true, lat: location.lat, lng: location.lng, formatted_address: data.results[0].formatted_address };
        }
        return { error: `Geocoding failed: ${data.status}` };
      } catch (e: any) {
        return { error: e.message };
      }
    }
  } as any);

  const show_hotel_carousel = tool({
    description: '展示酒店集合。',
    parameters: z.object({ title: z.string(), hotels: z.array(z.any()) }),
    execute: async () => ({ success: true })
  } as any);

  let finalSystemPrompt = baseSystemPrompt;
  if (intent === 'OUT_OF_SCOPE') {
    finalSystemPrompt = "拒绝回答此问题。包含不良内容。";
  } else if (intent === 'RESTRICTED') {
    activeTools = {};
    const restrictionError = checkTravelRestrictions(state.slots.originCity, lastMsgContent) || "受限行程。";
    finalSystemPrompt = `给出警告：${restrictionError}`;
  } else if (intent === 'GENERAL_CHAT') {
    activeTools = {};
    finalSystemPrompt = "闲聊模式。如果用户想聊天就回复友好，反之立即转移话题到旅游。";
  } else {
    if (intent === 'FLIGHT_AGENT') {
      activeTools = { search_flights_serpapi, show_flight_card, search_web };
      finalSystemPrompt += "\n【航班查询专属】务必立即使用 search_flights_serpapi 结合已知目的地进行查票，并使用 show_flight_card 呈现机票。";
    } else if (intent === 'HOTEL_AGENT') {
      activeTools = { search_hotels, show_hotel_carousel, search_web };
      finalSystemPrompt += "\n【订房验证专属】核实日期后，优先检索酒店信息，确保 is_open 后用 show_hotel_carousel 输出推荐。";
    } else {
      activeTools = { ask_user_preference, confirm_slot, show_map, search_web, search_place_coordinates, show_ground_transport_card };
      finalSystemPrompt += "\n【槽位提取约束】若提取到新信息，必须立即调用 confirm_slot 记录！如果用户想预订机票住宿，安抚他们并收集偏好。";
    }
  }

  const processedMessages = await compactContext(sanitizedMessages);
  const data = new StreamData();

  try {
    const result = await streamText({
      model: cloudModel,
      messages: processedMessages,
      system: finalSystemPrompt,
      maxSteps: 10,
      maxTokens: 4096,
      tools: activeTools,
      onFinish: async ({ text, toolResults }) => {
        try {
          // Do not await session saving to prevent hanging the response
          setSession(sessionId, state).catch(e => console.error('Session save error:', e));

          let factualityScore = 1.0;
          if (text) {
            try {
              const actualUserQuery = (sanitizedMessages as any[]).filter((m: any) => m.role === 'user').slice(-1)[0]?.content || lastMsgContent;

              // 5-second timeout for factuality grading to prevent stream hanging
              const gradingPromise = gradeFactuality(actualUserQuery, text);
              const timeoutPromise = new Promise<{ score: number }>((_, reject) => setTimeout(() => reject(new Error('Grade timeout')), 5000));
              const factuality = await Promise.race([gradingPromise, timeoutPromise]);

              factualityScore = factuality.score;
            } catch (e) {
              console.warn('Factuality eval skipped/error:', e);
            }
          }

          if (process.env.ENABLE_RAG_EVAL === 'true') {
            try {
              const retrievedContexts: string[] = [];
              const traceToolCalls: any[] = [];
              if (toolResults) {
                for (const tr of toolResults as any[]) {
                  const res = tr.result;
                  if (res?.answer) retrievedContexts.push(res.answer);
                  traceToolCalls.push({ toolName: tr.toolName, args: tr.args, result: JSON.stringify(res).slice(0, 500) });
                }
              }
              const actualUserQuery = (sanitizedMessages as any[]).filter((m: any) => m.role === 'user').slice(-1)[0]?.content || lastMsgContent;
              const ragTrace: RagTrace = {
                userQuery: actualUserQuery,
                retrievedContexts,
                llmAnswer: text || '',
                toolCalls: traceToolCalls,
                timestamp: new Date().toISOString(),
                sessionId,
              };
              const redis = getRedis();
              // Do not await trace recording
              redis.set(`eval:trace:${sessionId}:${Date.now()}`, JSON.stringify(ragTrace), 'EX', 86400).catch(e => console.error('Trace save error:', e));
            } catch (e) {
              console.error('Trace capture error:', e);
            }
          }

          data.append({ factualityScore });
        } finally {
          data.close();
        }
      }
    });

    return result.toDataStreamResponse({ data });
  } catch (error) {
    // If anything throws before the stream completes properly, force close it.
    console.error('Error during AI streaming setup:', error);
    data.close();
    return new Response(JSON.stringify({ error: 'AI Streaming Error' }), { status: 500 });
  }
}