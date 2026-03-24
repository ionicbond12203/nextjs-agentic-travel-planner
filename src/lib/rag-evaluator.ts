/**
 * RAG Triad Evaluation Engine (LLM-as-a-Judge)
 *
 * Evaluates RAG interactions on three dimensions:
 * 1. Context Relevance  — Are retrieved contexts relevant to the user query?
 * 2. Groundedness       — Is the answer faithful to the retrieved contexts?
 * 3. Answer Relevance   — Does the answer address the user's intent?
 *
 * Uses the same LLM endpoint (Ollama → cloud model) as the judge.
 */

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// ─── Types ──────────────────────────────────────────────────────────

export interface RagTrace {
  /** The user's original query */
  userQuery: string;
  /** All contexts retrieved by tools (search_web, search_hotels, etc.) */
  retrievedContexts: string[];
  /** The LLM's final text answer */
  llmAnswer: string;
  /** Tool calls made during this interaction */
  toolCalls?: {
    toolName: string;
    args: Record<string, any>;
    result?: any;
  }[];
  /** ISO timestamp */
  timestamp?: string;
  /** Session identifier */
  sessionId?: string;
}

export interface MetricScore {
  /** 0.0 – 1.0 */
  score: number;
  /** Chain-of-thought rationale from the judge */
  rationale: string;
}

export interface EvalResult {
  contextRelevance: MetricScore;
  groundedness: MetricScore;
  answerRelevance: MetricScore;
  /** Factual accuracy and policy compliance (visas, dates, etc.) */
  factuality: MetricScore;
  /** Aggregate score (simple average) */
  aggregateScore: number;
  /** Evaluation timestamp */
  evaluatedAt: string;
}

export interface BatchEvalResult {
  results: { caseName: string; trace: RagTrace; eval: EvalResult }[];
  aggregate: {
    contextRelevance: number;
    groundedness: number;
    answerRelevance: number;
    factuality: number;
    overall: number;
  };
  evaluatedAt: string;
}

// ─── Judge LLM Setup ────────────────────────────────────────────────

function getJudgeModel() {
  return openrouter("google/gemini-2.0-flash-001");
}

// ─── Judge Prompts ──────────────────────────────────────────────────

const CONTEXT_RELEVANCE_PROMPT = `You are an impartial evaluator assessing the relevance of retrieved contexts to a user query.

## Task
Given the USER QUERY and RETRIEVED CONTEXTS below, evaluate how relevant each context chunk is to answering the user's query.

## Scoring Rubric (0.0 – 1.0)
- 1.0: All contexts are directly relevant and sufficient to answer the query
- 0.8: Most contexts are relevant, minor irrelevant information
- 0.6: Some contexts are relevant but significant noise or gaps
- 0.4: Few contexts are relevant, mostly irrelevant retrieval
- 0.2: Barely any relevant information retrieved
- 0.0: Completely irrelevant contexts

## Output Format (STRICT JSON)
Respond with ONLY a JSON object, no markdown fences:
{"score": <number>, "rationale": "<your analysis>"}

## Input
USER QUERY: {userQuery}

RETRIEVED CONTEXTS:
{contexts}`;

const GROUNDEDNESS_PROMPT = `You are an impartial evaluator assessing whether an AI answer is grounded in the provided source contexts.

## Task
Given the RETRIEVED CONTEXTS and the AI ANSWER below, identify every factual claim in the answer and check if it is supported by the contexts.

## Key Checks
- Are prices, dates, policies EXACTLY as stated in the contexts?
- Are there claims that appear to come from parametric memory (not in any context)?
- Are there fabricated specifics (invented price hikes, made-up policies)?

## Scoring Rubric (0.0 – 1.0)
- 1.0: Every claim is directly supported by the contexts
- 0.8: Almost all claims supported, minor unsupported details
- 0.6: Most claims supported but some notable unsupported assertions
- 0.4: Significant unsupported claims or fabricated details
- 0.2: Most of the answer is not grounded in contexts
- 0.0: The answer is entirely hallucinated

## Output Format (STRICT JSON)
Respond with ONLY a JSON object, no markdown fences:
{"score": <number>, "rationale": "<your analysis, listing each claim and whether it is supported>"}

## Input
RETRIEVED CONTEXTS:
{contexts}

AI ANSWER:
{answer}`;

const ANSWER_RELEVANCE_PROMPT = `You are an impartial evaluator assessing whether an AI answer addresses the user's intent.

## Task
Given the USER QUERY and AI ANSWER below, evaluate how directly and completely the answer addresses what the user is asking for.

## Key Checks
- Does the answer address the core travel planning intent?
- Is the response on-topic (not drifting to unrelated areas)?
- Does it provide actionable information (not vague platitudes)?

## Scoring Rubric (0.0 – 1.0)
- 1.0: Perfectly addresses the user's intent with actionable detail
- 0.8: Addresses the intent well with minor gaps
- 0.6: Partially addresses intent but misses key aspects
- 0.4: Tangentially related but doesn't really answer the query
- 0.2: Mostly off-topic
- 0.0: Completely unrelated to the query

## Output Format (STRICT JSON)
Respond with ONLY a JSON object, no markdown fences:
{"score": <number>, "rationale": "<your analysis>"}

## Input
USER QUERY: {userQuery}

AI ANSWER:
{answer}`;

const FACTUALITY_PROMPT = `You are an expert travel policy and general fact-checker.

## Task
Evaluate the AI ANSWER for factual accuracy and compliance with real-world travel policies (visas, health, currency, current year info).

## Key Checks (CRITICAL)
- **Visas:** Singapore passports are visa-free for many countries (UK, EU). Check if the AI incorrectly demands a visa.
- **Dates:** If the user hasn't provided a travel date, did the AI "hallucinate" or force an implicit date (e.g., Apr 2026)?
- **Temporal Accuracy:** Is 2026 information handled correctly (e.g., Heathrow Express price hikes, opening dates)?

## Scoring Rubric (0.0 – 1.0)
- 1.0: Factually perfect and policy-compliant.
- 0.7: Mostly correct, but minor harmless inaccuracies.
- 0.4: Major factual error or misleading policy info (e.g., incorrect visa requirement).
- 0.0: Dangerous or completely false advice.

## Output Format (STRICT JSON)
Respond with ONLY a JSON object:
{"score": <number>, "rationale": "<your analysis of specific facts checked>"}

## Input
USER QUERY: {userQuery}
AI ANSWER: {answer}`;

// ─── Core Evaluation Logic ──────────────────────────────────────────

/**
 * Parse a JSON score response from the judge LLM.
 * Handles markdown code fences and malformed JSON gracefully.
 */
function parseJudgeResponse(text: string): MetricScore {
  try {
    // Aggressive JSON extraction: find anything between { and }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[RAG-Eval] No JSON found in response. Raw:", text);
      throw new Error("No JSON object found in judge response");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const score = Math.max(0, Math.min(1, Number(parsed.score) ?? 0));
    const rationale = String(parsed.rationale || "No rationale provided");

    return { score, rationale };
  } catch (e: any) {
    return { score: 0, rationale: `Parse error: ${e.message}. Raw response: ${text.slice(0, 300)}` };
  }
}

/**
 * Run a single judge prompt against the LLM.
 */
async function runJudge(promptTemplate: string, variables: Record<string, string>): Promise<MetricScore> {
  let prompt = promptTemplate;
  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replaceAll(`{${key}}`, value);
  }

  const model = getJudgeModel();

  try {
    const { text } = await generateText({
      model: model as any,
      prompt,
      maxTokens: 1024,
      temperature: 0,
    });

    return parseJudgeResponse(text);
  } catch (e: any) {
    console.error("[RAG-Eval] Judge call failed:", e.message);
    return { score: 0, rationale: `Judge call failed: ${e.message}` };
  }
}

// ─── Fast Individual Graders (Optimized for Real-time) ────────────────

/**
 * Grade context relevance only.
 */
export async function gradeContextRelevance(query: string, contexts: string[]): Promise<MetricScore> {
  const contextsStr = contexts.length > 0
    ? contexts.map((c, i) => `[Context ${i + 1}]: ${c}`).join("\n\n")
    : "[No contexts retrieved]";
  
  return runJudge(CONTEXT_RELEVANCE_PROMPT, {
    userQuery: query,
    contexts: contextsStr,
  });
}

/**
 * Grade groundedness only.
 */
export async function gradeGroundedness(contexts: string[], answer: string): Promise<MetricScore> {
  const contextsStr = contexts.length > 0
    ? contexts.map((c, i) => `[Context ${i + 1}]: ${c}`).join("\n\n")
    : "[No contexts retrieved]";
  
  return runJudge(GROUNDEDNESS_PROMPT, {
    contexts: contextsStr,
    answer,
  });
}

/**
 * Grade factuality only.
 */
export async function gradeFactuality(query: string, answer: string): Promise<MetricScore> {
  return runJudge(FACTUALITY_PROMPT, {
    userQuery: query,
    answer,
  });
}

/**
 * Fast evaluation of a trace (Context Relevance + Groundedness only)
 * Useful for real-time blocking or re-routing.
 */
export async function fastEvaluate(trace: RagTrace): Promise<{
  contextRelevance: MetricScore;
  groundedness: MetricScore;
  aggregate: number;
}> {
  const [cr, gr] = await Promise.all([
    gradeContextRelevance(trace.userQuery, trace.retrievedContexts),
    gradeGroundedness(trace.retrievedContexts, trace.llmAnswer)
  ]);

  return {
    contextRelevance: cr,
    groundedness: gr,
    aggregate: (cr.score + gr.score) / 2
  };
}

/**
 * Evaluate a single RAG trace against the RAG Triad.
 * Paced with delays to avoid rate limits during batch processing.
 */
export async function evaluateRagTriad(trace: RagTrace): Promise<EvalResult> {
  const contextsStr = trace.retrievedContexts.length > 0
    ? trace.retrievedContexts.map((c, i) => `[Context ${i + 1}]: ${c}`).join("\n\n")
    : "[No contexts retrieved]";

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  console.log(`[RAG-Eval] - Scoring Context Relevance...`);
  const contextRelevance = await gradeContextRelevance(trace.userQuery, trace.retrievedContexts);

  await delay(2000); 
  console.log(`[RAG-Eval] - Scoring Groundedness...`);
  const groundedness = await gradeGroundedness(trace.retrievedContexts, trace.llmAnswer);

  await delay(2000); 
  console.log(`[RAG-Eval] - Scoring Answer Relevance...`);
  const answerRelevance = await runJudge(ANSWER_RELEVANCE_PROMPT, {
    userQuery: trace.userQuery,
    answer: trace.llmAnswer,
  });

  await delay(2000); 
  console.log(`[RAG-Eval] - Scoring Factuality...`);
  const factuality = await gradeFactuality(trace.userQuery, trace.llmAnswer);

  const aggregateScore = Number(
    ((contextRelevance.score + groundedness.score + answerRelevance.score + factuality.score) / 4).toFixed(3)
  );

  return {
    contextRelevance,
    groundedness,
    answerRelevance,
    factuality,
    aggregateScore,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Evaluate a batch of test cases.
 * Changed to sequential execution to ensure stable scoring.
 */
export async function evaluateBatch(
  cases: { caseName: string; trace: RagTrace }[]
): Promise<BatchEvalResult> {
  const results: { caseName: string; trace: RagTrace; eval: EvalResult }[] = [];

  for (const { caseName, trace } of cases) {
    console.log(`[RAG-Eval] Evaluating case: ${caseName}...`);
    const evalResult = await evaluateRagTriad(trace);
    results.push({ caseName, trace, eval: evalResult });
  }

  const n = results.length || 1;
  const aggregate = {
    contextRelevance: Number((results.reduce((s, r) => s + r.eval.contextRelevance.score, 0) / n).toFixed(3)),
    groundedness: Number((results.reduce((s, r) => s + r.eval.groundedness.score, 0) / n).toFixed(3)),
    answerRelevance: Number((results.reduce((s, r) => s + r.eval.answerRelevance.score, 0) / n).toFixed(3)),
    factuality: Number((results.reduce((s, r) => s + r.eval.factuality.score, 0) / n).toFixed(3)),
    overall: Number((results.reduce((s, r) => s + r.eval.aggregateScore, 0) / n).toFixed(3)),
  };

  return {
    results,
    aggregate,
    evaluatedAt: new Date().toISOString(),
  };
}
