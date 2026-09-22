import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { FLOOR_RULE_IDS } from "./rules";
import type { PhiRule } from "./types";

/**
 * Loads the committee-maintained extension file, config/phi-patterns.json.
 *
 * "Without a deploy" means the file is read at RUNTIME and re-read whenever
 * its modification time changes. It can only ADD rules and stop words: the
 * built-in floor lives in code, so a malformed, empty or deleted file leaves
 * the approved control fully in force rather than switching it off.
 */

const MAX_PATTERN_LENGTH = 300;

/**
 * Rejects regular expressions with a quantified group that itself contains a
 * quantifier — the shape of catastrophic backtracking, e.g. `(a+)+` or
 * `(\w*x)*`. A committee member editing JSON should not be able to hang the
 * server with one bad pattern. Heuristic, not a proof; documented as such.
 */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/;

const patternSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "id must be lower_snake_case"),
    tier: z.enum(["block", "warn"]),
    category: z.enum(["identifier", "contact", "date", "location", "name", "other"]),
    pattern: z.string().min(1).max(MAX_PATTERN_LENGTH),
    flags: z
      .string()
      .regex(/^[imsu]*$/, "only the i, m, s and u flags are allowed")
      .default(""),
    message: z.string().min(1).max(200),
  })
  .superRefine((value, ctx) => {
    if (FLOOR_RULE_IDS.has(value.id)) {
      ctx.addIssue({
        code: "custom",
        message: `"${value.id}" is a built-in rule and cannot be redefined from the config file`,
      });
    }
    if (NESTED_QUANTIFIER.test(value.pattern)) {
      ctx.addIssue({
        code: "custom",
        message: `"${value.id}" has a nested quantifier, which can hang the server on crafted input`,
      });
    }
    try {
      new RegExp(value.pattern, value.flags);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: `"${value.id}" is not a valid regular expression: ${(error as Error).message}`,
      });
    }
  });

export const phiConfigSchema = z.object({
  version: z.literal(1),
  additionalPatterns: z.array(patternSchema).default([]),
  nameContextStopWords: z.array(z.string().regex(/^[A-Z][A-Za-z-]*$/)).default([]),
});

export type PhiConfig = z.infer<typeof phiConfigSchema>;

export interface LoadedConfig {
  rules: PhiRule[];
  nameContextStopWords: ReadonlySet<string>;
  /** Null when the file loaded cleanly; otherwise why it was ignored. */
  error: string | null;
  source: string;
}

const EMPTY: Omit<LoadedConfig, "error" | "source"> = {
  rules: [],
  nameContextStopWords: new Set(),
};

export function configPath(): string {
  return process.env["PHI_PATTERNS_PATH"] ?? join(process.cwd(), "config", "phi-patterns.json");
}

let cache: { path: string; mtimeMs: number; loaded: LoadedConfig } | null = null;

/** Returns the current extension config, re-reading the file if it changed. */
export function loadPhiConfig(path = configPath()): LoadedConfig {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    // No file: the floor applies on its own. Not an error — the committee may
    // simply not have added anything.
    return { ...EMPTY, error: null, source: path };
  }

  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) return cache.loaded;

  const loaded = parse(path);
  cache = { path, mtimeMs, loaded };
  if (loaded.error) {
    // Loud, because a silently ignored extension is a control the committee
    // believes exists and does not.
    console.error(`[phi] ${path} ignored; built-in rules still apply. ${loaded.error}`);
  }
  return loaded;
}

export function parsePhiConfig(raw: unknown, source = "inline"): LoadedConfig {
  const result = phiConfigSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ");
    return { ...EMPTY, error: `Invalid PHI pattern config — ${detail}`, source };
  }

  const rules: PhiRule[] = result.data.additionalPatterns.map((p) => {
    const re = new RegExp(p.pattern, `${p.flags}g`);
    return {
      id: p.id,
      tier: p.tier,
      category: p.category,
      message: p.message,
      find: (text: string) => {
        const spans: Array<[number, number]> = [];
        for (const match of text.matchAll(re)) {
          if (match.index === undefined || match[0].length === 0) continue;
          spans.push([match.index, match.index + match[0].length]);
        }
        return spans;
      },
    };
  });

  return {
    rules,
    nameContextStopWords: new Set(result.data.nameContextStopWords),
    error: null,
    source,
  };
}

function parse(path: string): LoadedConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { ...EMPTY, error: `Could not read JSON: ${(error as Error).message}`, source: path };
  }
  return parsePhiConfig(raw, path);
}

/** For tests: forget the cached file. */
export function resetPhiConfigCache(): void {
  cache = null;
}
