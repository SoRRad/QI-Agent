import { parseCsv, toCsv } from "@/lib/csv";

/**
 * The curriculum tracker (§6.6): completion by program and by trainee,
 * imported from and exported to CSV for ACGME reporting.
 *
 * The item list is whatever the records hold — the committee's curriculum is
 * defined by what it imports — so a new module appears when its first row does.
 * A trainee without a record for an item has not completed it.
 *
 * Import is all-or-nothing. A file with one bad row is refused whole, with
 * every problem listed by line, because a half-imported roster is worse than
 * none: nobody can tell which half landed.
 */

export const IMPORT_HEADERS = ["email", "item", "completed_on"] as const;
export const MAX_IMPORT_ROWS = 2000;

export interface ImportTrainee {
  id: string;
  email: string;
}

export interface ImportRow {
  line: number;
  userId: string;
  email: string;
  item: string;
  /** Null: the item is assigned but not complete. */
  completedOn: Date | null;
}

export type ImportResult = { ok: true; rows: ImportRow[] } | { ok: false; errors: string[] };

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(value: string): Date | null {
  const m = ISO_DAY.exec(value);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Rejects 2026-02-30, which Date would roll into March.
  return date.getUTCDate() === Number(m[3]) && date.getUTCMonth() === Number(m[2]) - 1 ? date : null;
}

/**
 * Parses an import file against the active trainees. `today` bounds
 * completion dates: a completion in the future is a typo, not a plan.
 */
export function parseCurriculumImport(text: string, trainees: readonly ImportTrainee[], today: Date): ImportResult {
  const csv = parseCsv(text, MAX_IMPORT_ROWS);
  if (csv.error) return { ok: false, errors: [csv.error] };
  const headers = csv.headers.map((h) => h.trim().toLowerCase());
  const missing = IMPORT_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length)
    return {
      ok: false,
      errors: [`The file needs the columns ${IMPORT_HEADERS.join(", ")}; missing: ${missing.join(", ")}.`],
    };
  if (csv.rows.length === 0) return { ok: false, errors: ["The file has no rows."] };

  const col = Object.fromEntries(IMPORT_HEADERS.map((h) => [h, headers.indexOf(h)])) as Record<(typeof IMPORT_HEADERS)[number], number>;
  const byEmail = new Map(trainees.map((t) => [t.email.toLowerCase(), t]));
  const errors: string[] = [...csv.warnings];
  const rows: ImportRow[] = [];
  const seen = new Set<string>();

  csv.rows.forEach((cells, i) => {
    const line = i + 2; // the header is line 1
    const email = (cells[col.email] ?? "").trim().toLowerCase();
    const item = (cells[col.item] ?? "").trim().replace(/\s+/g, " ");
    const completed = (cells[col.completed_on] ?? "").trim();
    const trainee = byEmail.get(email);
    if (!email) return errors.push(`Line ${line}: no email.`);
    if (!trainee) return errors.push(`Line ${line}: ${email} is not an active trainee.`);
    if (item.length < 3 || item.length > 120) return errors.push(`Line ${line}: the item must be 3 to 120 characters.`);
    const key = `${email}\u0000${item.toLowerCase()}`;
    if (seen.has(key)) return errors.push(`Line ${line}: ${email} already has a row for "${item}" in this file.`);
    seen.add(key);
    let completedOn: Date | null = null;
    if (completed) {
      completedOn = parseDay(completed);
      if (!completedOn) return errors.push(`Line ${line}: completed_on must be a date written YYYY-MM-DD, or blank.`);
      if (completedOn.getTime() > today.getTime()) return errors.push(`Line ${line}: completed_on ${completed} is in the future.`);
    }
    rows.push({ line, userId: trainee.id, email, item, completedOn });
  });

  return errors.length ? { ok: false, errors } : { ok: true, rows };
}

export interface TrackerTrainee {
  id: string;
  name: string;
  email: string;
  program: string;
}

export interface TrackerRecord {
  userId: string;
  item: string;
  completedAt: Date | null;
}

export interface ProgramCompletion {
  program: string;
  trainees: number;
  completed: number;
  possible: number;
  /** Whole percent, or null when there is nothing to complete. */
  percent: number | null;
}

export interface TraineeCompletion extends TrackerTrainee {
  completedAt: Record<string, Date | null>;
  completed: number;
}

export interface Tracker {
  items: string[];
  programs: ProgramCompletion[];
  trainees: TraineeCompletion[];
}

const percent = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

export function tracker(trainees: readonly TrackerTrainee[], records: readonly TrackerRecord[]): Tracker {
  const ids = new Set(trainees.map((t) => t.id));
  const relevant = records.filter((r) => ids.has(r.userId));
  const items = [...new Set(relevant.map((r) => r.item))].sort((a, b) => a.localeCompare(b));

  const rows: TraineeCompletion[] = trainees
    .map((t) => {
      const mine = relevant.filter((r) => r.userId === t.id);
      const completedAt = Object.fromEntries(items.map((item) => [item, mine.find((r) => r.item === item)?.completedAt ?? null]));
      return {
        ...t,
        completedAt,
        completed: Object.values(completedAt).filter(Boolean).length,
      };
    })
    .sort((a, b) => a.program.localeCompare(b.program) || a.name.localeCompare(b.name));

  const programs = [...new Set(rows.map((r) => r.program))].map((program) => {
    const inProgram = rows.filter((r) => r.program === program);
    const completed = inProgram.reduce((n, r) => n + r.completed, 0);
    const possible = inProgram.length * items.length;
    return {
      program,
      trainees: inProgram.length,
      completed,
      possible,
      percent: percent(completed, possible),
    };
  });

  return { items, programs, trainees: rows };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The export: one row per trainee per item, completed or not, in the same
 * columns the import reads (plus program and name), so an export can be
 * edited and imported back.
 */
export function curriculumCsv(t: Tracker): string {
  return toCsv([
    ["program", "trainee", ...IMPORT_HEADERS],
    ...t.trainees.flatMap((row) => t.items.map((item) => [row.program, row.name, row.email, item, row.completedAt[item] ? isoDay(row.completedAt[item]!) : ""])),
  ]);
}
