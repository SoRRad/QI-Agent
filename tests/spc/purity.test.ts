import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { analyse } from "@/lib/spc";
import type { Observation } from "@/lib/spc";

/**
 * The first non-negotiable constraint, asserted structurally rather than
 * trusted: no statistic in this system is produced by a language model.
 *
 * A convention holds until someone in a hurry breaks it. A test does not.
 */

const SPC_DIR = join(process.cwd(), "lib", "spc");

const sourceFiles = readdirSync(SPC_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ name: f, body: readFileSync(join(SPC_DIR, f), "utf8") }));

describe("lib/spc imports no language model", () => {
  it("has source files to check", () => {
    expect(sourceFiles.length).toBeGreaterThan(5);
  });

  for (const file of sourceFiles) {
    it(`${file.name} imports nothing model-related`, () => {
      const imports = [...file.body.matchAll(/^\s*import\s[\s\S]*?from\s+["']([^"']+)["']/gm)].map(
        (m) => m[1] ?? "",
      );

      for (const specifier of imports) {
        // Only relative imports within lib/spc and pure type imports are
        // permitted. Anything reaching for a provider, the database, or the
        // network does not belong in a module of pure functions.
        expect(
          /llm|anthropic|openai|azure|fetch|axios|@\/lib\/db|prisma/i.test(specifier),
          `${file.name} imports "${specifier}"`,
        ).toBe(false);
      }
    });
  }

  it("makes no network call and reads no environment variable", () => {
    const combined = sourceFiles.map((f) => f.body).join("\n");
    expect(combined).not.toMatch(/\bfetch\s*\(/);
    expect(combined).not.toMatch(/process\.env/);
  });
});

describe("analysis is deterministic", () => {
  const observations: Observation[] = Array.from({ length: 24 }, (_, i) => ({
    label: `p${i + 1}`,
    value: [12, 14, 11, 13, 15, 12, 14, 11, 13, 12, 14, 13, 5, 6, 4, 7, 5, 6, 4, 5, 6, 4, 5, 6][i] as number,
  }));

  it("returns identical results across repeated runs", () => {
    // Pure functions, no clock, no randomness: the same series must analyse
    // the same way every time, or a chart could change under a user between
    // two page loads.
    const first = JSON.stringify(analyse("run", observations));
    for (let i = 0; i < 5; i += 1) {
      expect(JSON.stringify(analyse("run", observations))).toBe(first);
    }
  });

  it("does not mutate the observations it is given", () => {
    const input = observations.map((o) => ({ ...o }));
    const snapshot = JSON.stringify(input);
    analyse("run", input);
    analyse("xmr", input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
