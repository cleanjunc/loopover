// Pareto-floor comparator for backtest score reports (#8086, parent epic #8082) -- applies the no-regression
// discipline vanguarstew's score_pr_delta.py established (cited for the scoring METHOD only; nothing imported
// or copied): a candidate that regresses on ANY measured axis is a regression, even while improving another.
// "Trading one axis for the other" can never read as a net win, so a rule fix can't be gamed by sacrificing
// recall for precision or vice versa.
//
// Pure, like everything in this module: no IO, no randomness, no wall-clock reads.

import type { BacktestScoreReport } from "./backtest-score.js";

export type BacktestComparison = {
  ruleId: string;
  baseline: BacktestScoreReport;
  candidate: BacktestScoreReport;
  regressedAxes: Array<"precision" | "recall">;
  improvedAxes: Array<"precision" | "recall">;
  verdict: "improved" | "regressed" | "unchanged";
};

/**
 * Compare a baseline and candidate score for the SAME rule. Per axis (precision, recall): when EITHER value
 * is null the axis is excluded from both lists (insufficient decided data is not comparable -- null is never
 * treated as 0 or as "no change"); otherwise strictly-less = regressed, strictly-greater = improved, equal =
 * neither. The verdict is "regressed" whenever ANY axis regressed -- the Pareto-floor rule, never a
 * weighted/averaged score -- else "improved" when any axis improved, else "unchanged". Throws when the two
 * reports carry different ruleIds (a caller bug, not a valid comparison).
 */
export function compareBacktestScores(baseline: BacktestScoreReport, candidate: BacktestScoreReport): BacktestComparison {
  if (baseline.ruleId !== candidate.ruleId) {
    throw new Error(`cannot compare backtest scores for different rules: ${baseline.ruleId} vs ${candidate.ruleId}`);
  }
  const regressedAxes: Array<"precision" | "recall"> = [];
  const improvedAxes: Array<"precision" | "recall"> = [];
  for (const axis of ["precision", "recall"] as const) {
    const baselineValue = baseline[axis];
    const candidateValue = candidate[axis];
    if (baselineValue === null || candidateValue === null) continue;
    if (candidateValue < baselineValue) regressedAxes.push(axis);
    else if (candidateValue > baselineValue) improvedAxes.push(axis);
  }
  const verdict = regressedAxes.length > 0 ? "regressed" : improvedAxes.length > 0 ? "improved" : "unchanged";
  return { ruleId: baseline.ruleId, baseline, candidate, regressedAxes, improvedAxes, verdict };
}
