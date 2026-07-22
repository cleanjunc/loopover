import { afterEach, describe, expect, it, vi } from "vitest";

import type { SignalStore } from "@loopover/engine";
import { recordAuditEvent } from "../../src/db/repositories";
import { recordReversalSignals } from "../../src/review/outcomes-wire";
import { CONFIGURED_GATE_BLOCKER_CODES, evaluateGateCheck, type GateCheckPolicy } from "../../src/rules/advisory";
import type { Advisory, AdvisoryFinding, GitHubPullRequestPayload } from "../../src/types";
import { createTestEnv } from "../helpers/d1";

// Delegating mock (#8104): default behavior is the REAL adapter (so most tests exercise the genuine
// audit_events round-trip), while individual tests can swap in a rejecting store to drive the fail-open
// `.catch`/`catch {}` branches — the one thing a real TestD1Database cannot be made to do on demand.
let storeOverride: SignalStore | null = null;
vi.mock("../../src/review/signal-tracking-wire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/review/signal-tracking-wire")>();
  return {
    ...actual,
    createSignalStore: (env: Env): SignalStore => storeOverride ?? actual.createSignalStore(env),
  };
});
// Imported AFTER the mock so seeding/asserting goes through the same (delegating) module the wired code uses.
import { createSignalStore } from "../../src/review/signal-tracking-wire";

afterEach(() => {
  storeOverride = null;
});

const ONE_HOUR_MS = 60 * 60 * 1000;

function finding(over: Partial<AdvisoryFinding> & { code: string }): AdvisoryFinding {
  return { title: `finding ${over.code}`, severity: "critical", detail: "detail", ...over };
}

function advisory(findings: AdvisoryFinding[]): Advisory {
  return {
    id: "advisory-8104",
    targetType: "pull_request",
    targetKey: "owner/repo#42",
    repoFullName: "owner/repo",
    pullNumber: 42,
    headSha: "sha42",
    conclusion: "neutral",
    severity: "warning",
    title: "LoopOver advisory available",
    summary: `${findings.length} advisory finding(s) generated.`,
    findings,
    generatedAt: "2026-07-22T00:00:00.000Z",
  };
}

/** Every opt-in sub-gate flipped to block, so each code in CONFIGURED_GATE_BLOCKER_CODES actually blocks. */
function allBlockPolicy(): GateCheckPolicy {
  return {
    linkedIssueGateMode: "block",
    duplicatePrGateMode: "block",
    aiReviewGateMode: "block",
    manifestPolicyGateMode: "block",
    selfAuthoredLinkedIssueGateMode: "block",
    linkedIssueSatisfactionGateMode: "block",
    contentLaneDeliverableGateMode: "block",
    lockfileIntegrityGateMode: "block",
    claGateMode: "block",
  };
}

async function firedFor(env: Env, code: string) {
  return (await createSignalStore(env).queryRuleHistory(code, Date.now() - ONE_HOUR_MS)).fired;
}

async function overridesFor(env: Env, code: string) {
  return (await createSignalStore(env).queryRuleHistory(code, Date.now() - ONE_HOUR_MS)).overrides;
}

// ── 1) evaluateGateCheck: generic rule-fired recording at the configuredBlockers computation ────────────────

describe("evaluateGateCheck — generic rule-fired recording (#8104)", () => {
  it("records a fired event for every configured blocker, with target/outcome/confidence intact", async () => {
    const env = createTestEnv();
    const result = evaluateGateCheck(
      advisory([
        finding({ code: "linked_issue_scope_mismatch", confidence: 0.9 }),
        finding({ code: "ai_consensus_defect", confidence: 0.7 }),
        finding({ code: "ai_review_split" }),
        finding({ code: "secret_leak" }),
        finding({ code: "readiness_score_below_threshold", severity: "warning" }),
      ]),
      allBlockPolicy(),
      { env, repoFullName: "owner/repo", prNumber: 42 },
    );
    expect(result.conclusion).toBe("failure");
    // The writes are fire-and-forget by design (#7982): poll the store rather than racing the microtask queue.
    await vi.waitFor(async () => {
      for (const code of ["linked_issue_scope_mismatch", "ai_consensus_defect", "ai_review_split", "secret_leak"]) {
        expect((await firedFor(env, code)).length, code).toBe(1);
      }
    });
    const scoped = await firedFor(env, "linked_issue_scope_mismatch");
    expect(scoped[0]).toMatchObject({ targetKey: "owner/repo#42", outcome: "critical", metadata: { confidence: 0.9 } });
    // A finding without a confidence records no metadata at all — the optional-property arm, not `undefined`.
    expect((await firedFor(env, "ai_review_split"))[0]?.metadata).toBeUndefined();
    // The warning finding never reached configuredBlockers, so nothing was recorded for it.
    expect(await firedFor(env, "readiness_score_below_threshold")).toHaveLength(0);
  });

  it("records nothing when no signal context is passed (pure-evaluation callers stay side-effect-free)", async () => {
    const env = createTestEnv();
    const result = evaluateGateCheck(advisory([finding({ code: "secret_leak" })]), allBlockPolicy());
    expect(result.conclusion).toBe("failure");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await firedFor(env, "secret_leak")).toHaveLength(0);
  });

  it("dry-run: records the real eval's blockers exactly once and never the promoted would-be blockers", async () => {
    const env = createTestEnv();
    const result = evaluateGateCheck(
      advisory([finding({ code: "secret_leak" }), finding({ code: "ai_consensus_defect" })]),
      // aiReview stays advisory here, so ai_consensus_defect blocks ONLY inside the promoted would-be re-eval.
      { dryRun: true, linkedIssueGateMode: "block" },
      { env, repoFullName: "owner/repo", prNumber: 42 },
    );
    expect(result.displayConclusion).toBe("failure");
    await vi.waitFor(async () => expect(await firedFor(env, "secret_leak")).toHaveLength(1));
    // Not 2: the would-be re-eval runs without the signal context, so the same blocker is not double-counted…
    expect(await firedFor(env, "secret_leak")).toHaveLength(1);
    // …and a finding that blocks only under promotion is a phantom, never a real gate decision.
    expect(await firedFor(env, "ai_consensus_defect")).toHaveLength(0);
  });

  it("fail-open: a rejecting store never affects the verdict or throws", async () => {
    const env = createTestEnv();
    storeOverride = {
      recordRuleFired: () => Promise.reject(new Error("signal store down")),
      recordHumanOverride: () => Promise.reject(new Error("signal store down")),
      queryRuleHistory: () => Promise.reject(new Error("signal store down")),
    };
    const result = evaluateGateCheck(advisory([finding({ code: "secret_leak" })]), allBlockPolicy(), {
      env,
      repoFullName: "owner/repo",
      prNumber: 42,
    });
    expect(result.conclusion).toBe("failure");
    expect(result.blockers.map((blocker) => blocker.code)).toContain("secret_leak");
    // Give the dropped rejection a tick to surface if the `.catch(() => undefined)` were ever removed —
    // vitest fails the run on an unhandled rejection, so reaching the next assertion IS the assertion.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});

// ── 2) CONFIGURED_GATE_BLOCKER_CODES stays in lockstep with isConfiguredGateBlocker ─────────────────────────

describe("CONFIGURED_GATE_BLOCKER_CODES — drift guard (#8104)", () => {
  it("every listed code actually blocks under an everything-block policy", () => {
    for (const code of CONFIGURED_GATE_BLOCKER_CODES) {
      const result = evaluateGateCheck(advisory([finding({ code })]), allBlockPolicy());
      expect(result.blockers.map((blocker) => blocker.code), code).toContain(code);
    }
  });

  it("an unrecognized code never blocks, and the list holds no duplicates", () => {
    const result = evaluateGateCheck(advisory([finding({ code: "definitely_not_a_gate_code" })]), allBlockPolicy());
    expect(result.blockers).toHaveLength(0);
    expect(new Set(CONFIGURED_GATE_BLOCKER_CODES).size).toBe(CONFIGURED_GATE_BLOCKER_CODES.length);
  });
});

// ── 3) recordReversalSignals: generic "reversed" overrides for every code with a prior firing ───────────────

/** Seed the bot's own last action on a PR into the agent-action audit ledger (mirrors outcomes-wire.test.ts). */
async function seedBotAction(env: Env, targetKey: string, actionClass: "close" | "merge" | "approve"): Promise<void> {
  await recordAuditEvent(env, { eventType: `agent.action.${actionClass}`, targetKey, outcome: "completed" });
}

function pullRequestPayload(over: Partial<GitHubPullRequestPayload> = {}): GitHubPullRequestPayload {
  return { number: 7, title: "PR", state: "closed", head: { sha: "s7" }, labels: [], ...over };
}

async function seedFired(env: Env, code: string, targetKey: string): Promise<void> {
  await createSignalStore(env).recordRuleFired({ ruleId: code, targetKey, outcome: "critical", occurredAt: new Date().toISOString() });
}

async function reversalRows(env: Env): Promise<number> {
  const res = await env.DB.prepare("SELECT 1 AS hit FROM audit_events WHERE event_type = ?").bind("reversal_reopened").all();
  return (res.results ?? []).length;
}

describe("recordReversalSignals — generic blocker overrides (#8104)", () => {
  it("a contributor reopen marks 'reversed' for every code with a prior firing on that exact target", async () => {
    const env = createTestEnv();
    await seedFired(env, "linked_issue_scope_mismatch", "owner/repo#7");
    await seedFired(env, "secret_leak", "owner/repo#7");
    await seedFired(env, "duplicate_pr_risk", "owner/repo#99"); // other PR — must NOT be swept in
    await seedBotAction(env, "owner/repo#7", "close");
    await recordReversalSignals(env, "pull_request", {
      action: "reopened",
      repository: { name: "repo", full_name: "owner/repo", owner: { login: "owner" } },
      pull_request: pullRequestPayload({ number: 7, state: "open" }),
      sender: { login: "contributor", type: "User" },
    });
    for (const code of ["linked_issue_scope_mismatch", "secret_leak"]) {
      const overrides = await overridesFor(env, code);
      expect(overrides.length, code).toBe(1);
      expect(overrides[0]).toMatchObject({ targetKey: "owner/repo#7", verdict: "reversed" });
    }
    expect(await overridesFor(env, "duplicate_pr_risk")).toHaveLength(0);
    expect(await reversalRows(env)).toBe(1);
  });

  it("the owner-reopen-then-merge path records the same generic overrides once the merge lands", async () => {
    const env = createTestEnv();
    await seedFired(env, "ai_consensus_defect", "owner/repo#7");
    await seedBotAction(env, "owner/repo#7", "close");
    const repository = { name: "repo", full_name: "owner/repo", owner: { login: "owner" } };
    await recordReversalSignals(env, "pull_request", {
      action: "reopened",
      repository,
      pull_request: pullRequestPayload({ number: 7, state: "open" }),
      sender: { login: "owner", type: "User" },
    });
    // A bare owner reopen is only a pending marker — not yet a reversal, so no override either.
    expect(await overridesFor(env, "ai_consensus_defect")).toHaveLength(0);
    await recordReversalSignals(env, "pull_request", {
      action: "closed",
      repository,
      pull_request: pullRequestPayload({ number: 7, state: "closed", merged_at: new Date().toISOString() }),
      sender: { login: "owner", type: "User" },
    });
    const overrides = await overridesFor(env, "ai_consensus_defect");
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ targetKey: "owner/repo#7", verdict: "reversed" });
  });

  it("records no override when the target has no prior firing for any code", async () => {
    const env = createTestEnv();
    await seedBotAction(env, "owner/repo#7", "close");
    await recordReversalSignals(env, "pull_request", {
      action: "reopened",
      repository: { name: "repo", full_name: "owner/repo", owner: { login: "owner" } },
      pull_request: pullRequestPayload({ number: 7, state: "open" }),
      sender: { login: "contributor", type: "User" },
    });
    for (const code of CONFIGURED_GATE_BLOCKER_CODES) {
      expect(await overridesFor(env, code), code).toHaveLength(0);
    }
    expect(await reversalRows(env)).toBe(1);
  });

  it("best-effort: a failing history query skips overrides but never the reversal itself", async () => {
    const env = createTestEnv();
    await seedFired(env, "secret_leak", "owner/repo#7");
    await seedBotAction(env, "owner/repo#7", "close");
    storeOverride = {
      recordRuleFired: () => Promise.reject(new Error("signal store down")),
      recordHumanOverride: () => Promise.reject(new Error("signal store down")),
      queryRuleHistory: () => Promise.reject(new Error("signal store down")),
    };
    await recordReversalSignals(env, "pull_request", {
      action: "reopened",
      repository: { name: "repo", full_name: "owner/repo", owner: { login: "owner" } },
      pull_request: pullRequestPayload({ number: 7, state: "open" }),
      sender: { login: "contributor", type: "User" },
    });
    storeOverride = null;
    expect(await overridesFor(env, "secret_leak")).toHaveLength(0);
    expect(await reversalRows(env)).toBe(1);
  });
});
