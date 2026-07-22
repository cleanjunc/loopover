import { describe, expect, it } from "vitest";
// Direct src-path imports — the coverage-twin pattern test/unit/backtest-corpus.test.ts established for this
// module (the engine's own node:test suite runs against dist, invisible to codecov/patch).
import { compareBacktestScores } from "../../packages/loopover-engine/src/calibration/backtest-compare.js";
import { renderBacktestComparison, renderBacktestScoreReport } from "../../packages/loopover-engine/src/calibration/backtest-report.js";
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

describe("renderBacktestScoreReport (#8088)", () => {
  it("renders the exact table for a non-null fixture (snapshot)", () => {
    expect(renderBacktestScoreReport(report())).toBe(
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

  it("renders null precision/recall as the literal N/A", () => {
    const rendered = renderBacktestScoreReport(report({ precision: null, recall: null }));
    expect(rendered).toContain("| Precision | N/A |");
    expect(rendered).toContain("| Recall | N/A |");
    expect(rendered).not.toContain("null");
  });
});

describe("renderBacktestComparison (#8088)", () => {
  it("keeps regressed and improved axes in visually separate sections and closes with REGRESSED — do not merge", () => {
    const rendered = renderBacktestComparison(compareBacktestScores(report(), report({ precision: 0.95, recall: 0.6 })));
    expect(rendered).toContain("REGRESSED");
    expect(rendered).toContain("do not merge");
    const regressedSection = rendered.slice(rendered.indexOf("**Regressed**"), rendered.indexOf("**Improved**"));
    expect(regressedSection).toContain("recall");
    expect(regressedSection).not.toContain("- precision");
  });

  it("renders an improved comparison with no Regressed section at all", () => {
    const rendered = renderBacktestComparison(compareBacktestScores(report(), report({ precision: 0.9, recall: 0.85 })));
    expect(rendered).not.toContain("**Regressed**");
    expect(rendered).toContain("Verdict: improved");
  });

  it("omits a null-excluded axis from both sections entirely", () => {
    const rendered = renderBacktestComparison(compareBacktestScores(report({ precision: null }), report({ precision: null, recall: 0.9 })));
    expect(rendered).not.toContain("precision");
    expect(rendered).toContain("- recall: 0.8 → 0.9");
    expect(rendered).toContain("Verdict: improved");
  });

  it("states the unchanged verdict in words and is byte-identically deterministic", () => {
    const comparison = compareBacktestScores(report(), report());
    const first = renderBacktestComparison(comparison);
    expect(first).toContain("Verdict: unchanged");
    expect(renderBacktestComparison(comparison)).toBe(first);
  });
});
