// The Governor chokepoint gate (#2340). Wraps the pure `evaluateGovernorChokepoint` engine decision with the
// two stateful side effects every caller needs: persisting the resulting ledger event, and advancing/backing-off
// the rate-limit bucket state for the actions that genuinely consumed a slot. This is the ONLY sanctioned
// call site a real write action (open_pr, file_issue, apply_labels, post_eligibility_comment, create_branch,
// delete_branch, generate_tests) should be gated through.

import {
  clearWriteRateLimitBackoff,
  evaluateGovernorChokepoint,
  recordWriteRateLimitAllowed,
  recordWriteRateLimitDenied,
} from "@loopover/engine";
import { appendGovernorEvent } from "./governor-ledger.js";

/**
 * Evaluate a write action against the full Governor precedence ladder, persist the resulting ledger event, and
 * advance rate-limit bucket/backoff state only for the final verdict that actually earned it: a full `"allow"`
 * consumes a bucket slot and clears backoff, a `"rate_limit"` denial records a backoff attempt, and every other
 * stage (kill-switch, dry-run, and any later-stage denial) leaves rate-limit state untouched.
 *
 * @param {import("@loopover/engine").GovernorChokepointInput} input
 * @param {{ append?: typeof appendGovernorEvent }} [options]
 * @returns {{
 *   decision: import("@loopover/engine").GovernorDecision,
 *   recorded: import("./governor-ledger.js").GovernorLedgerEntry,
 *   rateLimitBuckets: import("@loopover/engine").WriteRateLimitBucketStore,
 *   rateLimitBackoffAttempts: import("@loopover/engine").WriteRateLimitBackoffStore,
 * }}
 */
export function evaluateGovernorChokepointGate(input, options = {}) {
  const append = options.append ?? appendGovernorEvent;
  const decision = evaluateGovernorChokepoint(input);
  const recorded = append(decision.ledgerEvent);

  let rateLimitBuckets = input.rateLimitBuckets;
  let rateLimitBackoffAttempts = input.rateLimitBackoffAttempts;
  // Gate on the FINAL stage, never on `decision.detail.rateLimit.allowed`: `detail` accumulates each stage's
  // result as the ladder advances, so a cleared rate-limit sub-verdict stays `allowed: true` on a decision some
  // LATER stage (budget cap, non-convergence, reputation throttle, self-plagiarism, internal error) ultimately
  // denied. Reading it alone burned a bucket slot for a write that never happened, letting a repo that keeps
  // failing an unrelated stage exhaust its own rate-limit window on phantom writes (#5925).
  if (decision.stage === "allow") {
    rateLimitBuckets = recordWriteRateLimitAllowed(
      input.rateLimitBuckets,
      input.actionClass,
      input.repoFullName,
      input.nowMs,
      input.rateLimitPolicies,
    );
    rateLimitBackoffAttempts = clearWriteRateLimitBackoff(input.rateLimitBackoffAttempts, input.actionClass, input.repoFullName);
  } else if (decision.stage === "rate_limit") {
    rateLimitBackoffAttempts = recordWriteRateLimitDenied(input.rateLimitBackoffAttempts, input.actionClass, input.repoFullName);
  }

  return { decision, recorded, rateLimitBuckets, rateLimitBackoffAttempts };
}
