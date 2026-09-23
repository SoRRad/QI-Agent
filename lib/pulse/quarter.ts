/**
 * Pulse runs by calendar quarter ("2026-Q3"). Pure, so pages and tests agree
 * on what "this quarter" means.
 */

const QUARTER = /^(\d{4})-Q([1-4])$/;

export function quarterOf(date: Date): string {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

export function isQuarter(value: string): boolean {
  return QUARTER.test(value);
}

export function nextQuarter(quarter: string): string {
  const m = QUARTER.exec(quarter);
  if (!m) throw new Error(`Not a quarter: ${quarter}`);
  const year = Number(m[1]);
  const q = Number(m[2]);
  return q === 4 ? `${year + 1}-Q1` : `${year}-Q${q + 1}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-Q3" → "July – September 2026". */
export function quarterLabel(quarter: string): string {
  const m = QUARTER.exec(quarter);
  if (!m) return quarter;
  const first = (Number(m[2]) - 1) * 3;
  return `${MONTHS[first]} – ${MONTHS[first + 2]} ${m[1]}`;
}
