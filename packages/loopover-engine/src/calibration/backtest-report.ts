// Markdown renderers for backtest results (#8088, parent epic #8082) -- the human-readable "receipt" a
// maintainer (and, per the epic's proposal, a future advisory CI comment) reads directly. Deterministic pure
// functions producing stable Markdown: byte-identical input -> byte-identical output, never ad-hoc logging.
//
// Pure, like everything in this module: string in, string out; no IO, no wall-clock reads.

import type { BacktestComparison } from "./backtest-compare.js";
import type { BacktestScoreReport } from "./backtest-score.js";

/** Render a null-able rate as its number, or the literal `N/A` -- never `0`, `null`, or an empty cell (the
 *  null-is-not-zero discipline BacktestScoreReport itself establishes). */
function renderRate(value: number | null): string {
  return value === null ? "N/A" : String(value);
}

/** Render one score report as a Markdown table: rule ID, case count, all four confusion-matrix counts, and
 *  precision/recall (null rendered as `N/A`). */
export function renderBacktestScoreReport(report: BacktestScoreReport): string {
  return [
    `### Backtest score: \`${report.ruleId}\``,
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Cases scored | ${report.caseCount} |`,
    `| True positives | ${report.truePositive} |`,
    `| False positives | ${report.falsePositive} |`,
    `| True negatives | ${report.trueNegative} |`,
    `| False negatives | ${report.falseNegative} |`,
    `| Precision | ${renderRate(report.precision)} |`,
    `| Recall | ${renderRate(report.recall)} |`,
    "",
  ].join("\n");
}

/**
 * Render a comparison with clearly separated Regressed / Improved sections (an axis only ever appears under
 * its own heading) and a closing verdict line. The regressed closing line contains the literal word
 * `REGRESSED` and states the change should not be merged -- exact wording a future automated consumer can
 * string-match without re-implementing the comparison.
 */
export function renderBacktestComparison(comparison: BacktestComparison): string {
  const lines: string[] = [`### Backtest comparison: \`${comparison.ruleId}\``, ""];
  if (comparison.regressedAxes.length > 0) {
    lines.push("**Regressed**", "");
    for (const axis of comparison.regressedAxes) {
      // A listed axis is non-null on BOTH sides by compareBacktestScores's own exclusion rule.
      lines.push(`- ${axis}: ${comparison.baseline[axis]} → ${comparison.candidate[axis]}`);
    }
    lines.push("");
  }
  if (comparison.improvedAxes.length > 0) {
    lines.push("**Improved**", "");
    for (const axis of comparison.improvedAxes) {
      lines.push(`- ${axis}: ${comparison.baseline[axis]} → ${comparison.candidate[axis]}`);
    }
    lines.push("");
  }
  if (comparison.verdict === "regressed") {
    lines.push("Verdict: REGRESSED — do not merge (a regression on any axis outweighs improvement on another).");
  } else if (comparison.verdict === "improved") {
    lines.push("Verdict: improved — no axis regressed and at least one improved.");
  } else {
    lines.push("Verdict: unchanged — no comparable axis moved in either direction.");
  }
  lines.push("");
  return lines.join("\n");
}
