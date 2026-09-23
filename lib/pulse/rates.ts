/**
 * Response rate by program (§6.4), computed here and never by a model.
 *
 * The numerator is participation — who responded, not what they said — and
 * the denominator is the program's active trainees. A response's optional
 * "program" field is not used: it is the respondent's choice to share, and a
 * rate built on it would count only the people who chose to.
 */

export interface ProgramCounts {
  programId: string;
  program: string;
  trainees: number;
  responded: number;
}

export interface ProgramRate extends ProgramCounts {
  /** Whole percent, or null when the program has no active trainees. */
  percent: number | null;
}

export function responseRates(rows: readonly ProgramCounts[]): { programs: ProgramRate[]; total: ProgramRate } {
  const percent = (responded: number, trainees: number) => (trainees > 0 ? Math.round((responded / trainees) * 100) : null);
  const programs = rows
    .map((r) => ({ ...r, percent: percent(r.responded, r.trainees) }))
    .sort((a, b) => a.program.localeCompare(b.program));
  const trainees = rows.reduce((n, r) => n + r.trainees, 0);
  const responded = rows.reduce((n, r) => n + r.responded, 0);
  return { programs, total: { programId: "all", program: "All programs", trainees, responded, percent: percent(responded, trainees) } };
}
