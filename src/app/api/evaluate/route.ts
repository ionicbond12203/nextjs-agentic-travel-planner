/**
 * RAG Evaluation API Endpoint
 *
 * POST /api/evaluate       — Evaluate a single RagTrace
 * POST /api/evaluate/batch  — Evaluate all predefined test cases (via query param ?mode=batch)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  evaluateRagTriad,
  evaluateBatch,
  RagTrace,
} from "@/lib/rag-evaluator";
import { EVAL_TEST_CASES } from "@/lib/eval-test-cases";

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");

  try {
    // ── Batch mode: evaluate all predefined test cases ──
    if (mode === "batch") {
      console.log("[RAG-Eval] Starting batch evaluation...");
      const startTime = Date.now();

      const cases = EVAL_TEST_CASES.map((tc) => ({
        caseName: tc.caseName,
        trace: tc.trace,
      }));

      const batchResult = await evaluateBatch(cases);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[RAG-Eval] Batch evaluation completed in ${elapsed}s`);

      // Attach expected scores for validation
      const enrichedResults = batchResult.results.map((r) => {
        const testCase = EVAL_TEST_CASES.find((tc) => tc.caseName === r.caseName);
        const passed = testCase
          ? r.eval.contextRelevance.score >= testCase.expectedScores.contextRelevance.min &&
            r.eval.contextRelevance.score <= testCase.expectedScores.contextRelevance.max &&
            r.eval.groundedness.score >= testCase.expectedScores.groundedness.min &&
            r.eval.groundedness.score <= testCase.expectedScores.groundedness.max &&
            r.eval.answerRelevance.score >= testCase.expectedScores.answerRelevance.min &&
            r.eval.answerRelevance.score <= testCase.expectedScores.answerRelevance.max &&
            // Ensure factuality exists and is scored (defaults to passing if not specified in legacy cases)
            (!r.eval.factuality || r.eval.factuality.score >= 0.4)
          : null;

        return {
          ...r,
          expectedScores: testCase?.expectedScores,
          passed,
        };
      });

      const passedCount = enrichedResults.filter((r) => r.passed === true).length;
      const totalCount = enrichedResults.length;

      return NextResponse.json({
        ...batchResult,
        results: enrichedResults,
        summary: {
          passed: passedCount,
          failed: totalCount - passedCount,
          total: totalCount,
          passRate: `${((passedCount / totalCount) * 100).toFixed(1)}%`,
        },
        elapsedSeconds: Number(elapsed),
      });
    }

    // ── Single trace mode ──
    const body = await req.json();
    const trace: RagTrace = {
      userQuery: body.userQuery,
      retrievedContexts: body.retrievedContexts || [],
      llmAnswer: body.llmAnswer,
      toolCalls: body.toolCalls,
      timestamp: body.timestamp,
      sessionId: body.sessionId,
    };

    if (!trace.userQuery || !trace.llmAnswer) {
      return NextResponse.json(
        { error: "Missing required fields: userQuery, llmAnswer" },
        { status: 400 }
      );
    }

    console.log("[RAG-Eval] Evaluating single trace...");
    const startTime = Date.now();
    const result = await evaluateRagTriad(trace);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(
      `[RAG-Eval] Single evaluation completed in ${elapsed}s — ` +
        `CR: ${result.contextRelevance.score} | GR: ${result.groundedness.score} | AR: ${result.answerRelevance.score}`
    );

    return NextResponse.json({ ...result, elapsedSeconds: Number(elapsed) });
  } catch (e: any) {
    console.error("[RAG-Eval] Evaluation error:", e);
    return NextResponse.json(
      { error: e.message || "Evaluation failed" },
      { status: 500 }
    );
  }
}
