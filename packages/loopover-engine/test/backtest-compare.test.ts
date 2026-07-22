import assert from "node:assert/strict";
import { test } from "node:test";

import { compareBacktestScores, type BacktestScoreReport } from "../dist/index.js";

// #8086: the Pareto-floor comparator. The one non-negotiable case: an improvement on one axis NEVER cancels
// a regression on the other — verdict is "regressed" the moment any axis regressed.

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

test("both axes improve -> verdict improved with empty regressedAxes", () => {
  const comparison = compareBacktestScores(report(), report({ precision: 0.9, recall: 0.85 }));
  assert.deepEqual(comparison.regressedAxes, []);
  assert.deepEqual(comparison.improvedAxes, ["precision", "recall"]);
  assert.equal(comparison.verdict, "improved");
});

test("PARETO FLOOR: one axis improves while the other regresses -> verdict regressed", () => {
  const comparison = compareBacktestScores(report(), report({ precision: 0.95, recall: 0.6 }));
  assert.deepEqual(comparison.improvedAxes, ["precision"]);
  assert.deepEqual(comparison.regressedAxes, ["recall"]);
  assert.equal(comparison.verdict, "regressed");
});

test("a null on either side excludes that axis from both lists — null is never 0 and never 'no change'", () => {
  const baselineNull = compareBacktestScores(report({ precision: null }), report({ precision: 0.99, recall: 0.9 }));
  assert.deepEqual(baselineNull.regressedAxes, []);
  assert.deepEqual(baselineNull.improvedAxes, ["recall"]);

  const candidateNull = compareBacktestScores(report(), report({ recall: null, precision: 0.7 }));
  assert.deepEqual(candidateNull.regressedAxes, ["precision"]);
  assert.deepEqual(candidateNull.improvedAxes, []);
  assert.equal(candidateNull.verdict, "regressed");
});

test("mismatched ruleId throws, and the message contains both rule IDs", () => {
  assert.throws(
    () => compareBacktestScores(report({ ruleId: "rule_a" }), report({ ruleId: "rule_b" })),
    (error: Error) => error.message.includes("rule_a") && error.message.includes("rule_b"),
  );
});

test("all comparable axes equal -> verdict unchanged with both lists empty", () => {
  const comparison = compareBacktestScores(report(), report());
  assert.deepEqual(comparison.regressedAxes, []);
  assert.deepEqual(comparison.improvedAxes, []);
  assert.equal(comparison.verdict, "unchanged");
});

test("the comparison carries ruleId and both full reports through", () => {
  const baseline = report();
  const candidate = report({ precision: 0.9 });
  const comparison = compareBacktestScores(baseline, candidate);
  assert.equal(comparison.ruleId, "rule");
  assert.equal(comparison.baseline, baseline);
  assert.equal(comparison.candidate, candidate);
});
