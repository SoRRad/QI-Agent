import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The static half of the PHI chokepoint.
 *
 * The guard lives inside the database client (lib/phi/extension.ts). That is
 * only a guarantee if application code has no OTHER way to write:
 *
 *   1. Nothing under app/, lib/ or components/ constructs its own client —
 *      except lib/db.ts, which is where the guard is attached.
 *   2. Nothing writes with raw SQL, which bypasses query extensions.
 *   3. Raw SQL reads are allowed only where the statement is visibly a SELECT.
 *
 * The seed and the tests construct clients deliberately and are outside these
 * directories. The seed still writes through createDb(), so block-tier rules
 * apply to it too.
 */

const ROOT = process.cwd();
const SCANNED_DIRS = ["app", "lib", "components"];
const EXCLUDED = [/^lib\/generated\//];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full);
    if (EXCLUDED.some((re) => re.test(rel))) continue;
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SCANNED_DIRS.flatMap((d) => sourceFiles(join(ROOT, d))).map((path) => ({
  path: relative(ROOT, path),
  body: readFileSync(path, "utf8"),
}));

describe("the database client is the only write path", () => {
  it("has application source to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("constructs a PrismaClient only in lib/db.ts", () => {
    const offenders = files
      .filter((f) => f.path !== "lib/db.ts")
      .filter((f) => /new\s+PrismaClient\s*\(/.test(f.body))
      .map((f) => f.path);
    expect(offenders, "construct clients through createDb() so the PHI guard is attached").toEqual([]);
  });

  it("imports the PrismaClient class as a value only in lib/db.ts", () => {
    // Type-only imports are fine; importing the class is the first step to
    // constructing an unguarded client.
    const offenders = files
      .filter((f) => f.path !== "lib/db.ts")
      .filter((f) =>
        /import\s+(?!type\b)\{[^}]*\bPrismaClient\b[^}]*\}\s+from\s+["']@\/lib\/generated\/prisma\/client["']/.test(f.body),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("never writes with raw SQL, which bypasses the guard", () => {
    const offenders = files.filter((f) => /\$executeRaw(?:Unsafe)?\b/.test(f.body)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("uses raw SQL only for statements that are visibly SELECTs", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const match of file.body.matchAll(/\$queryRaw(?:Unsafe)?\s*(?:<[^>]*>)?\s*\(\s*([`"'])([\s\S]*?)\1/g)) {
        const statement = (match[2] ?? "").trim();
        if (!/^(select|with)\b/i.test(statement)) violations.push(`${file.path}: ${statement.slice(0, 40)}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
