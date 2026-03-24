/**
 * RAG Triad Evaluation CLI Runner
 *
 * Usage:
 *   node scripts/run-eval.mjs [--threshold 0.6] [--base-url http://localhost:3000]
 *
 * Runs all predefined test cases against the /api/evaluate endpoint
 * and prints a formatted report. Exits with code 1 if any metric
 * falls below the threshold.
 */

const BASE_URL = process.argv.includes('--base-url')
  ? process.argv[process.argv.indexOf('--base-url') + 1]
  : 'http://127.0.0.1:3000';

const THRESHOLD = process.argv.includes('--threshold')
  ? parseFloat(process.argv[process.argv.indexOf('--threshold') + 1])
  : 0.6;

async function runEval() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        RAG Triad Evaluation (LLM-as-a-Judge)           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\n🎯 Target:    ${BASE_URL}/api/evaluate`);
  console.log(`📊 Threshold: ${THRESHOLD}`);
  console.log(`⏳ Starting batch evaluation...\n`);

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes timeout

  try {
    const res = await fetch(`${BASE_URL}/api/evaluate?mode=batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`❌ API returned ${res.status}: ${errorText}`);
      process.exit(1);
    }

    const data = await res.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // ── Print per-case results ──
    console.log('┌──────────────────────────────────┬──────────┬──────────┬──────────┬──────────┬──────────┬────────┐');
    console.log('│ Test Case                        │ Ctx.Rel. │ Grounded │ Ans.Rel. │ Fact.    │ Avg      │ Status │');
    console.log('├──────────────────────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┼────────┤');

    let anyFailed = false;

    for (const r of data.results) {
      const name = r.caseName.padEnd(32).slice(0, 32);
      const cr = r.eval.contextRelevance.score.toFixed(2).padStart(6);
      const gr = r.eval.groundedness.score.toFixed(2).padStart(6);
      const ar = r.eval.answerRelevance.score.toFixed(2).padStart(6);
      const ft = r.eval.factuality ? r.eval.factuality.score.toFixed(2).padStart(6) : "  N/A ";
      const avg = r.eval.aggregateScore.toFixed(2).padStart(6);
      const passed = r.passed;
      const status = passed ? '  ✅  ' : '  ❌  ';

      if (!passed) anyFailed = true;

      console.log(`│ ${name} │ ${cr}   │ ${gr}   │ ${ar}   │ ${ft}   │ ${avg}   │${status}│`);
    }

    console.log('└──────────────────────────────────┴──────────┴──────────┴──────────┴──────────┴──────────┴────────┘');

    // ── Print aggregate scores ──
    console.log('\n📈 Aggregate Scores:');
    console.log(`   Context Relevance:  ${data.aggregate.contextRelevance.toFixed(3)}`);
    console.log(`   Groundedness:       ${data.aggregate.groundedness.toFixed(3)}`);
    console.log(`   Answer Relevance:   ${data.aggregate.answerRelevance.toFixed(3)}`);
    if (data.aggregate.factuality !== undefined) {
      console.log(`   Factuality:         ${data.aggregate.factuality.toFixed(3)}`);
    }
    console.log(`   Overall:            ${data.aggregate.overall.toFixed(3)}`);

    // ── Print summary ──
    console.log(`\n📋 Summary: ${data.summary.passed}/${data.summary.total} passed (${data.summary.passRate})`);
    console.log(`⏱️  Completed in ${elapsed}s`);

    // ── Print detailed rationales for failed cases ──
    const failedCases = data.results.filter((r) => !r.passed);
    if (failedCases.length > 0) {
      console.log('\n─── Failed Case Details ───');
      for (const r of failedCases) {
        console.log(`\n❌ ${r.caseName}:`);
        console.log(`   Context Relevance (${r.eval.contextRelevance.score}): ${r.eval.contextRelevance.rationale.slice(0, 150)}`);
        console.log(`   Groundedness (${r.eval.groundedness.score}): ${r.eval.groundedness.rationale.slice(0, 150)}`);
        console.log(`   Answer Relevance (${r.eval.answerRelevance.score}): ${r.eval.answerRelevance.rationale.slice(0, 150)}`);
        if (r.eval.factuality) {
          console.log(`   Factuality (${r.eval.factuality.score}): ${r.eval.factuality.rationale.slice(0, 150)}`);
        }

        if (r.expectedScores) {
          let expectedRanges = `   Expected ranges: CR[${r.expectedScores.contextRelevance.min}-${r.expectedScores.contextRelevance.max}] ` +
            `GR[${r.expectedScores.groundedness.min}-${r.expectedScores.groundedness.max}] ` +
            `AR[${r.expectedScores.answerRelevance.min}-${r.expectedScores.answerRelevance.max}]`;
          if (r.expectedScores.factuality) {
            expectedRanges += ` FT[${r.expectedScores.factuality.min}-${r.expectedScores.factuality.max}]`;
          }
          console.log(expectedRanges);
        }
      }
    }

    // ── Check threshold ──
    const belowThreshold =
      data.aggregate.contextRelevance < THRESHOLD ||
      data.aggregate.groundedness < THRESHOLD ||
      data.aggregate.answerRelevance < THRESHOLD;

    if (belowThreshold) {
      console.log(`\n🚨 FAIL: One or more aggregate metrics fell below threshold (${THRESHOLD})`);
      process.exit(1);
    }

    if (anyFailed) {
      console.log(`\n⚠️  WARNING: Some individual test cases failed expected score ranges.`);
      process.exit(1);
    }

    console.log('\n✅ All evaluations passed!');
    process.exit(0);

  } catch (e) {
    console.error(`\n💥 Fatal error: ${e.message}`);
    console.error('Make sure the dev server is running: npm run dev');
    process.exit(1);
  }
}

runEval();
