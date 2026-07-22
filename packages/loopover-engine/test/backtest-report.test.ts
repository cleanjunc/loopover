import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareBacktestScores,
  renderBacktestComparison,
  renderBacktestScoreReport,
  type BacktestScoreReport,
} from "../dist/index.js";

// #8088: the Markdown "receipt" renderers. Null rates render as the literal `N/A` (never 0/null/empty), a
// regressed comparison's closing line contains the literal REGRESSED + do-not-merge wording, and both
// functions are byte-identically deterministic.

function report(overrides: Partial<BacktestScoreReport> = {}): BacktestScoreReport {
  return {
    ruleId: "rule",
    caseCount: 10,
    truePositive: 4,
    falsePositive: 1,
    trueNegative: 4,
    falseNegative: 1,
    precision: 0.8,
    recall: 0.8,
    ...overrides,
  };
}

test("renderBacktestScoreReport: exact snapshot for a non-null fixture", () => {
  assert.equal(
    renderBacktestScoreReport(report()),
    [
      "### Backtest score: `rule`",
      "",
      "| Metric | Value |",
      "| --- | --- |",
      "| Cases scored | 10 |",
      "| True positives | 4 |",
      "| False positives | 1 |",
      "| True negatives | 4 |",
      "| False negatives | 1 |",
      "| Precision | 0.8 |",
      "| Recall | 0.8 |",
      "",
    ].join("\n"),
  );
});

test("renderBacktestScoreReport: null precision/recall render as the literal N/A, never 0 or null", () => {
  const rendered = renderBacktestScoreReport(report({ precision: null, recall: null }));
  assert.ok(rendered.includes("| Precision | N/A |"));
  assert.ok(rendered.includes("| Recall | N/A |"));
  assert.ok(!rendered.includes("| Precision | 0 |"));
  assert.ok(!rendered.includes("null"));
});

test("renderBacktestComparison: a regressed verdict's closing line contains REGRESSED and do-not-merge wording", () => {
  const comparison = compareBacktestScores(report(), report({ precision: 0.95, recall: 0.6 }));
  const rendered = renderBacktestComparison(comparison);
  assert.ok(rendered.includes("REGRESSED"));
  assert.ok(rendered.includes("do not merge"));
  // The regressed axis appears only under Regressed; the improved axis only under Improved.
  const regressedSection = rendered.slice(rendered.indexOf("**Regressed**"), rendered.indexOf("**Improved**"));
  assert.ok(regressedSection.includes("recall"));
  assert.ok(!regressedSection.includes("- precision"));
});

test("renderBacktestComparison: an improved comparison renders no regressed axis claim", () => {
  const comparison = compareBacktestScores(report(), report({ precision: 0.9, recall: 0.85 }));
  const rendered = renderBacktestComparison(comparison);
  assert.ok(rendered.includes("**Improved**"));
  assert.ok(!rendered.includes("**Regressed**"));
  assert.ok(rendered.includes("Verdict: improved"));
});

test("renderBacktestComparison: unchanged verdict states unchanged in words", () => {
  const rendered = renderBacktestComparison(compareBacktestScores(report(), report()));
  assert.ok(rendered.includes("Verdict: unchanged"));
});

test("both renderers are byte-identically deterministic for identical input", () => {
  const scoreReport = report({ precision: null });
  assert.equal(renderBacktestScoreReport(scoreReport), renderBacktestScoreReport(scoreReport));
  const comparison = compareBacktestScores(report(), report({ recall: 0.9 }));
  assert.equal(renderBacktestComparison(comparison), renderBacktestComparison(comparison));
});
