import { describe, expect, it } from "vitest";
// Direct src-path import (not the package barrel, which resolves to dist and is outside vitest's
// coverage.include) — the same coverage-twin pattern test/unit/backtest-corpus.test.ts established for this
// module: the engine's own node:test suite runs against dist and is invisible to codecov/patch.
import { compareBacktestScores } from "../../packages/loopover-engine/src/calibration/backtest-compare.js";
import type { BacktestScoreReport } from "../../packages/loopover-engine/src/calibration/backtest-score.js";

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

describe("compareBacktestScores (#8086)", () => {
  it("marks both axes improved when both rise, with an improved verdict", () => {
    const comparison = compareBacktestScores(report(), report({ precision: 0.9, recall: 0.85 }));
    expect(comparison).toMatchObject({ regressedAxes: [], improvedAxes: ["precision", "recall"], verdict: "improved" });
  });

  it("PARETO FLOOR: a single regressed axis forces the regressed verdict even when the other axis improved", () => {
    const comparison = compareBacktestScores(report(), report({ precision: 0.95, recall: 0.6 }));
    expect(comparison.improvedAxes).toEqual(["precision"]);
    expect(comparison.regressedAxes).toEqual(["recall"]);
    expect(comparison.verdict).toBe("regressed");
  });

  it("excludes an axis from both lists when either side is null — never treated as 0 or as no-change", () => {
    const baselineNull = compareBacktestScores(report({ precision: null }), report({ precision: 0.99, recall: 0.9 }));
    expect(baselineNull.regressedAxes).toEqual([]);
    expect(baselineNull.improvedAxes).toEqual(["recall"]);

    const candidateNull = compareBacktestScores(report(), report({ recall: null, precision: 0.7 }));
    expect(candidateNull.regressedAxes).toEqual(["precision"]);
    expect(candidateNull.verdict).toBe("regressed");

    const bothNull = compareBacktestScores(report({ precision: null, recall: null }), report({ precision: null, recall: null }));
    expect(bothNull.verdict).toBe("unchanged");
  });

  it("throws on mismatched ruleIds, naming both", () => {
    expect(() => compareBacktestScores(report({ ruleId: "rule_a" }), report({ ruleId: "rule_b" }))).toThrow(
      "cannot compare backtest scores for different rules: rule_a vs rule_b",
    );
  });

  it("reports unchanged when every comparable axis is equal", () => {
    expect(compareBacktestScores(report(), report()).verdict).toBe("unchanged");
  });
});
