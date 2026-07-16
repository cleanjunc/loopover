import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStaleVersionMatchers,
  collectVersionCopyFailures,
  isMinimumSupportedContext,
  readMinimumSupportedVersion,
  SOURCE_LATEST_PATH,
} from "../../scripts/check-ui-mcp-version-copy.mjs";

const root = process.cwd();
const SCRIPT_PATH = "scripts/check-ui-mcp-version-copy.mjs";
const sourceText = readFileSync(join(root, SOURCE_LATEST_PATH), "utf8");

function declaredConstant(name: string): string {
  const value = new RegExp(`${name}\\s*=\\s*"([^"]+)"`).exec(sourceText)?.[1];
  if (value === undefined)
    throw new Error(`Could not find ${name} in ${SOURCE_LATEST_PATH}.`);
  return value;
}

describe("check-ui-mcp-version-copy script (#6292)", () => {
  it("derives the minimum-supported floor from the shipped constant, so the scan can't drift", () => {
    // The whole point of #6292: the floor must come from the single source of truth the app ships, not a
    // hardcoded literal that froze several majors behind reality.
    const declared = declaredConstant("MCP_MINIMUM_SUPPORTED_VERSION");
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
    expect(readMinimumSupportedVersion(join(root, SOURCE_LATEST_PATH))).toBe(
      declared,
    );
  });

  it("no longer hardcodes the years-stale 0.2 floor literal it was frozen at", () => {
    const scriptText = readFileSync(join(root, SCRIPT_PATH), "utf8");
    expect(scriptText).not.toContain("0.2");
  });

  describe("buildStaleVersionMatchers", () => {
    it("rejects a non-semver floor so a malformed source constant fails loudly", () => {
      expect(() => buildStaleVersionMatchers("0.5")).toThrow(/semver/);
    });

    it("targets the floor's own major.minor and exact version", () => {
      const matchers = buildStaleVersionMatchers("1.2.3");
      expect(matchers.floorVersion).toBe("1.2.3");
      expect(matchers.minorLabel).toBe("1.2");
      expect(matchers.visibleVersion.test("v1.2")).toBe(true);
      expect(matchers.visibleVersion.test("v1.2.3")).toBe(true);
      expect(matchers.versionRange.test("1.2.x")).toBe(true);
      expect(matchers.floor.test("1.2.3")).toBe(true);
      // A neighbouring release must not be mistaken for the floor.
      expect(matchers.floor.test("1.2.4")).toBe(false);
    });
  });

  describe("collectVersionCopyFailures", () => {
    const matchers = buildStaleVersionMatchers("0.5.0");

    it("flags a bare floor version used outside a minimum-supported statement", () => {
      const failures = collectVersionCopyFailures({
        label: "README.md",
        text: "@loopover/mcp/0.5.0 (api 0.1.0, node v22.12.0)",
        matchers,
      });
      expect(failures).toEqual([
        "README.md:1: 0.5.0 is only allowed as an explicit minimum-supported compatibility floor",
      ]);
    });

    it("allows the floor version when the line is an explicit minimum-supported floor", () => {
      const failures = collectVersionCopyFailures({
        label: "mcp-package.ts",
        text: 'export const MCP_MINIMUM_SUPPORTED_VERSION = "0.5.0";',
        matchers,
      });
      expect(failures).toEqual([]);
    });

    it("flags visible v-prefixed minor text and the .x range on the same line", () => {
      const failures = collectVersionCopyFailures({
        label: "a.md",
        text: "use v0.5 or the 0.5.x range",
        matchers,
      });
      expect(failures).toEqual([
        "a.md:1: stale visible v0.5 version text",
        "a.md:1: stale 0.5.x package-version range",
      ]);
    });

    it("does not flag the current package version or non-version 0.5 fragments", () => {
      const failures = collectVersionCopyFailures({
        label: "b.md",
        text: "@loopover/mcp/3.0.0\npy-0.5 gap-0.5\ntransition duration 0.2",
        matchers,
      });
      expect(failures).toEqual([]);
    });
  });

  it("recognizes minimum-supported context markers", () => {
    expect(
      isMinimumSupportedContext("the minimum supported version is X"),
    ).toBe(true);
    expect(isMinimumSupportedContext("supportedVersionRange: >=X")).toBe(true);
    expect(isMinimumSupportedContext("just some prose")).toBe(false);
  });

  it("passes cleanly against the real repo docs with the registry check stubbed offline", () => {
    const knownLatest = declaredConstant("MCP_PACKAGE_KNOWN_LATEST_VERSION");
    const out = execFileSync(process.execPath, [SCRIPT_PATH], {
      encoding: "utf8",
      env: { ...process.env, LOOPOVER_MCP_LATEST_VERSION: knownLatest },
    });
    expect(out).toContain("MCP UI version copy ok");
    expect(out).toContain(
      `minimum floor ${declaredConstant("MCP_MINIMUM_SUPPORTED_VERSION")}`,
    );
  });
});
