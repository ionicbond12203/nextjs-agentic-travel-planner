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

const cloudModel = ollama("glm-5:cloud");

function getSessionId(req: Request): string {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';
  return `${ip}-${ua}`.slice(0, 64);
}

function getFastIntent(message: string, state: DialogueState): string | null {
  const content = message.toLowerCase();
  if (/^(hi|hello|hey|你好|您好|哈喽|早上好|下午好|在吗)/i.test(content) && content.length < 15) {
    return 'general_chat';
  }
  if (content.includes('航班') || content.includes('飞机') || content.includes('机票') || content.includes('flight')) {
    return 'flight_inquiry';
  }
  if (state.stage === 'collecting' && (content.includes('天') || content.includes('风格') || content.includes('去') || content.length < 10)) {
    return 'travel_planning';
  }
  if (/(暴力|色情|毒品|自杀|枪支|炸药|非法|赌博|vpn|翻墙)/i.test(content)) {
    return 'out_of_scope';
  }
  let origin = state.slots.originCity;
  if (!origin) {
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

function pruneMessages(messages: any[]): any[] {
  if (messages.length < 15) return messages;
  const systemMsg = messages[0];
  const initialUserMsg = messages[1];
  const recentMessages = messages.slice(-12);
  return [systemMsg, initialUserMsg, ...recentMessages];
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
  const { messages, language = 'en' } = await req.json();
  const sanitizedMessages = messages.map((m: any) => ({ ...m }));
  const sessionId = getSessionId(req);
  let state = (await getSession(sessionId)) || initDialogueState();
  const country = req.headers.get('x-vercel-ip-country') || 'Malaysia (MYR)';
  const currentDateTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const currentYear = new Date().getFullYear();

  state = syncDialogueState(sanitizedMessages, state);

  const baseSystemPrompt = buildSystemPrompt({
    state,
    currentDateTime,
    currentYear,
    userCountry: country,
    language: language as 'en' | 'zh',
  });

  const lastMsg = sanitizedMessages[sanitizedMessages.length - 1];
  const lastMsgContent = lastMsg.content || "";
  let intent: string;
  let activeTools: any = {};

  const fastIntent = getFastIntent(lastMsgContent, state);
  if (fastIntent) {
    intent = fastIntent;
  } else if (lastMsg.role === 'tool' && (lastMsg.toolName === 'ask_user_preference' || lastMsg.toolName === 'confirm_slot')) {
    intent = 'travel_planning';
  } else {
    intent = 'travel_planning';
  }

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

  // --- Logic Routing ---
  let finalSystemPrompt = baseSystemPrompt;
  if (intent === 'out_of_scope') {
    finalSystemPrompt = "拒绝非旅游话题。";
  } else if (intent === 'restricted_travel') {
    activeTools = {};
    const restrictionError = checkTravelRestrictions(state.slots.originCity, lastMsgContent) || "受限行程。";
    finalSystemPrompt = `给出警告：${restrictionError}`;
  } else if (intent === 'general_chat') {
    activeTools = {};
    finalSystemPrompt = "闲聊模式。";
  } else {
    activeTools = { ask_user_preference, confirm_slot, show_map, search_web, search_place_coordinates };
    if (state.slots.travelStyle && !state.slots.travelStyle.includes('跟团')) {
      activeTools.search_hotels = search_hotels;
      activeTools.show_ground_transport_card = show_ground_transport_card;
      activeTools.show_hotel_carousel = show_hotel_carousel;
    }
    if (canSearchFlights(state)) {
      activeTools.search_flights_serpapi = search_flights_serpapi;
      activeTools.show_flight_card = show_flight_card;
      finalSystemPrompt += "\n【航班查询已解锁】如果用户同意或主动要求查询航班，请立即调用 search_flights_serpapi 获取实时数据。";
    }
    finalSystemPrompt += "\n【槽位提取约束】若提取到新信息，必须立即调用 confirm_slot 记录！";
  }

  const processedMessages = pruneMessages(sanitizedMessages);
  const data = new StreamData();

  const result = await streamText({
    model: cloudModel,
    messages: processedMessages,
    system: finalSystemPrompt,
    maxSteps: 10,
    maxTokens: 4096,
    tools: activeTools,
    onFinish: async ({ text, toolResults }) => {
      await setSession(sessionId, state);
      let factualityScore = 1.0;
      if (text) {
        const actualUserQuery = (sanitizedMessages as any[]).filter((m: any) => m.role === 'user').slice(-1)[0]?.content || lastMsgContent;
        const factuality = await gradeFactuality(actualUserQuery, text);
        factualityScore = factuality.score;
      }

      // Captured Trace for Evaluation
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
          await redis.set(`eval:trace:${sessionId}:${Date.now()}`, JSON.stringify(ragTrace), 'EX', 86400);
        } catch (e) { }
      }

      data.append({ factualityScore });
      data.close();
    }
  });

  return result.toDataStreamResponse({ data });
}