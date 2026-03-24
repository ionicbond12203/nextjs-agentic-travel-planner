/**
 * Predefined Evaluation Test Cases for RAG Triad
 *
 * Each case is a simulated RagTrace with known expected behavior
 * to validate the evaluation framework's scoring accuracy.
 */

import { RagTrace } from "./rag-evaluator";

export interface EvalTestCase {
  caseName: string;
  description: string;
  trace: RagTrace;
  /** Expected score ranges for validation */
  expectedScores: {
    contextRelevance: { min: number; max: number };
    groundedness: { min: number; max: number };
    answerRelevance: { min: number; max: number };
    factuality?: { min: number; max: number };
  };
}

export const EVAL_TEST_CASES: EvalTestCase[] = [
  // ────────────────────────────────────────
  // ✅ POSITIVE CASES (should score high)
  // ────────────────────────────────────────
  {
    caseName: "grounded_paris_pricing",
    description: "LLM answer correctly reflects retrieved Louvre pricing for non-EU tourists",
    trace: {
      userQuery: "我是马来西亚人，想去巴黎玩5天，卢浮宫门票多少钱？",
      retrievedContexts: [
        "Louvre Museum 2026 ticket prices: €22 for EEA citizens, €32 for non-EU international visitors. Free for under-18s. New pricing effective January 14, 2026. Source: louvre.fr official",
        "Paris 5-day itinerary: Day 1 - Louvre Museum, Day 2 - Eiffel Tower, Day 3 - Versailles, Day 4 - Montmartre, Day 5 - Shopping at Champs-Élysées",
      ],
      llmAnswer:
        "卢浮宫2026年门票价格（自1月14日起生效）：\n• 非欧盟游客（马来西亚适用）：€32（约 RM154）\n• 18岁以下：免费\n（价格查自 2026 实时搜索）",
      toolCalls: [
        {
          toolName: "search_web",
          args: { query: "Louvre Museum 2026 official ticket price non-EU visitor", verification_target: "NUMERICAL_ENTITY_CHECK" },
          result: { answer: "€32 for non-EU visitors" },
        },
      ],
    },
    expectedScores: {
      contextRelevance: { min: 0.7, max: 1.0 },
      groundedness: { min: 0.8, max: 1.0 },
      answerRelevance: { min: 0.7, max: 1.0 },
    },
  },

  {
    caseName: "grounded_flight_search",
    description: "LLM correctly reports flight data from search results",
    trace: {
      userQuery: "从吉隆坡飞巴黎的航班有哪些？",
      retrievedContexts: [
        "KUL-CDG flights: Malaysia Airlines MH20 direct, ~13h, MYR 3,200. Qatar Airways QR847 via Doha, ~18h, MYR 2,800. Emirates EK347 via Dubai, ~17h, MYR 2,950.",
      ],
      llmAnswer:
        "为您找到以下航班：\n1. 马航 MH20 直飞，约13小时，MYR 3,200\n2. 卡塔尔航空 QR847 经多哈转机，约18小时，MYR 2,800\n3. 阿联酋航空 EK347 经迪拜转机，约17小时，MYR 2,950",
      toolCalls: [
        { toolName: "search_flights_serpapi", args: { departure_id: "KUL", arrival_id: "CDG" } },
      ],
    },
    expectedScores: {
      contextRelevance: { min: 0.8, max: 1.0 },
      groundedness: { min: 0.9, max: 1.0 },
      answerRelevance: { min: 0.8, max: 1.0 },
    },
  },

  // ────────────────────────────────────────
  // ❌ NEGATIVE CASES (should score low)
  // ────────────────────────────────────────
  {
    caseName: "hallucinated_price_hike",
    description: "LLM fabricates a 2026 price increase not found in search results",
    trace: {
      userQuery: "2026年纽约CityPASS多少钱？",
      retrievedContexts: [
        "New York CityPASS: Includes access to 5 top attractions. Adults $146, Children (6-17) $124. Source: citypass.com. Last updated: 2025.",
      ],
      llmAnswer:
        "2026年纽约CityPASS已涨价15%！\n• 成人：$168（较2025年上涨$22）\n• 儿童：$143\n这是因为纽约市政府2026年新增了旅游附加税。",
      toolCalls: [
        { toolName: "search_web", args: { query: "New York CityPASS 2026 price" } },
      ],
    },
    expectedScores: {
      contextRelevance: { min: 0.5, max: 1.0 }, // context is relevant, just not 2026
      groundedness: { min: 0.0, max: 0.4 },     // heavily hallucinated
      answerRelevance: { min: 0.5, max: 0.9 },  // addresses the question, just wrong
    },
  },

  {
    caseName: "irrelevant_context_retrieval",
    description: "search_web returned content about wrong city entirely",
    trace: {
      userQuery: "东京有什么好吃的拉面店？",
      retrievedContexts: [
        "Paris best restaurants 2026: Le Comptoir du Panthéon offers classic French cuisine. Pierre Hermé for macarons. Le Bouillon Chartier for affordable dining.",
        "London food guide: Borough Market, Dishoom for Indian food, Padella for pasta.",
      ],
      llmAnswer:
        "东京有许多著名拉面店推荐：\n1. 一蘭拉面（Ichiran）- 天然豚骨汤底\n2. 六厘舍（Rokurinsha）- 浓厚�的蘸面\n3. 富士山拉面 - 独特的辛味噌",
      toolCalls: [
        { toolName: "search_web", args: { query: "Paris restaurants 2026" } },
      ],
    },
    expectedScores: {
      contextRelevance: { min: 0.0, max: 0.2 }, // totally wrong city
      groundedness: { min: 0.0, max: 0.3 },     // answer not from contexts
      answerRelevance: { min: 0.5, max: 0.9 },  // answer IS about ramen in Tokyo
    },
  },

  {
    caseName: "intent_drift",
    description: "User asks about flights but answer discusses hotel recommendations",
    trace: {
      userQuery: "帮我查一下从新加坡飞东京的航班",
      retrievedContexts: [
        "SIN-NRT flights: Singapore Airlines SQ12, 7h direct, SGD 850. ANA NH842, 7h direct, SGD 780. Scoot TR808, 7h15m, SGD 450.",
      ],
      llmAnswer:
        "东京住宿推荐：\n1. 新宿华盛顿酒店 - 交通便利，靠近新宿站\n2. 浅草豪景酒店 - 传统氛围，可步行到浅草寺\n3. 涩谷STREAM酒店 - 时尚设计，适合年轻旅客\n\n建议提前预订，旺季房价较高。",
      toolCalls: [
        { toolName: "search_flights_serpapi", args: { departure_id: "SIN", arrival_id: "NRT" } },
      ],
    },
    expectedScores: {
      contextRelevance: { min: 0.7, max: 1.0 }, // context IS about flights (correct retrieval)
      groundedness: { min: 0.0, max: 0.2 },     // hotels are not in the contexts
      answerRelevance: { min: 0.0, max: 0.3 },  // user asked for flights, got hotels
    },
  },

  {
    caseName: "no_context_honest_disclaimer",
    description: "No search results but LLM honestly disclaims instead of hallucinating",
    trace: {
      userQuery: "2026年日本JR Pass全国版多少钱？",
      retrievedContexts: [],
      llmAnswer:
        "⚠️ 暂未获取到2026年JR Pass最新官方票价，请查阅JR官方网站 japanrailpass.net 获取最新信息。\n\n参考2025年价格：7日票约 ¥50,000（约 RM1,515），但2026年政策可能有变动。",
      toolCalls: [
        { toolName: "search_web", args: { query: "Japan Rail Pass 2026 official price" } },
      ],
    },
    expectedScores: {
      contextRelevance: { min: 0.0, max: 0.2 }, // no contexts
      groundedness: { min: 0.4, max: 0.8 },     // honest disclaimer is partially grounded
      answerRelevance: { min: 0.6, max: 1.0 },  // addresses the intent with disclaimer
    },
  },

  {
    caseName: "london_agentic_hallucination",
    description: "Expert-reviewed case with specific visa hallucination and implicit date assumptions",
    trace: {
      userQuery: "我想从新加坡出发去伦敦旅游9-12天，自由行",
      retrievedContexts: [
        "London Pass 2026: 2-choice £82.99, 3-choice £123.99. British Museum: Free entry. Heathrow Express 2026: £10-17. Elizabeth Line: £15.50 (from March 1, 2026).",
        "Etihad SIN-LHR Apr 2026: SGD 854. Hotels: Six Senses London (~£500), citizenM Olympia (~£150).",
      ],
      llmAnswer:
        "好的！已为您规划2026年4月的伦敦行程...\n⚠️ 签证：新加坡护照持有者前往英国旅游需提前申请标准访客签证（Standard Visitor Visa）。\n✈️ 航班：为您选择了2026年4月7日的阿提哈德航空，往返 SGD 854。\n🏨 酒店：推荐入住 Waldorf Astoria Admiralty Arch 或 Six Senses London。",
      toolCalls: [
        { toolName: "search_web", args: { query: "London Pass 2026 price" } },
        { toolName: "search_flights", args: { from: "SIN", to: "LHR", date: "2026-04-07" } },
      ],
    },
    expectedScores: {
      contextRelevance: { min: 0.8, max: 1.0 },
      groundedness: { min: 0.0, max: 0.5 },     // Should score low due to visa hallucination and forced date
      answerRelevance: { min: 0.7, max: 1.0 },
      factuality: { min: 0.0, max: 0.5 },      // Specifically targeting the visa hallucination
    },
  },
  {
    caseName: "self_correcting_query_rewrite",
    description: "Agent receives low relevance feedback and rewrites the query to get better results",
    trace: {
      userQuery: "2026年伦敦通票包含哪些景点？",
      retrievedContexts: [
        "London Pass (old data): 80+ attractions including Tower of London, Westminster Abbey. (Feedback: Low relevance, missing 2026 specific updates)",
        "The London Pass 2026 official: Includes 90+ attractions. New additions for 2026: The Outlook, Thames River Cruise (Electric). Price: £89/day.",
      ],
      llmAnswer:
        "根据 2026 年最新查询，伦敦通票（London Pass）包含 90 多个景点。2026 年新增了 The Outlook 和泰晤士河电动游船体验，一日价为 £89。",
      toolCalls: [
        { 
          toolName: "search_web", 
          args: { query: "London Pass attractions" },
          result: { answer: "80+ attractions...", relevanceScore: 0.4, feedback: "不相关，缺少2026更新" }
        },
        { 
          toolName: "search_web", 
          args: { query: "London Pass 2026 official attractions list" },
          result: { answer: "90+ attractions, includes The Outlook..." }
        },
      ],
    },
    expectedScores: {
      contextRelevance: { min: 0.8, max: 1.0 },
      groundedness: { min: 0.8, max: 1.0 },
      answerRelevance: { min: 0.8, max: 1.0 },
    },
  },
];

