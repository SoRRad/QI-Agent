import type { PhiRule, RuleContext } from "./types";

/**
 * The built-in PHI rules: a FLOOR that the committee's config file can extend
 * but never remove or weaken.
 *
 * Tier assignments are exactly the approved tiering (Q7), plus one addition
 * marked ADDITION below and recorded in docs/SECURITY.md.
 *
 * Every rule returns spans, never text. Two principles shape the patterns:
 *
 *   1. The block tier has NO override, so a block-tier false positive stops a
 *      trainee cold. Block patterns are therefore narrow and literal, and the
 *      false-positive suite in tests/phi runs every one of them against
 *      ordinary QI prose.
 *   2. The warn tier is advisory, so it can be broader — but a warn that fires
 *      on every aim statement teaches people to click through it. Warn
 *      patterns target what identifies a PERSON (a full date, a room number, a
 *      name after a title), not what describes a PROJECT (a month and year, a
 *      count, a rate).
 */

function allMatches(pattern: RegExp, text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  for (const match of text.matchAll(re)) {
    if (match.index === undefined || match[0].length === 0) continue;
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

/** A run of digits not part of a longer run and not a decimal fraction. */
const digitRun = (min: number, max?: number): RegExp =>
  new RegExp(`(?<![\\d.])\\d{${min},${max ?? ""}}(?!\\d)`, "g");

// ---------------------------------------------------------------- block

const ssn: PhiRule = {
  id: "ssn",
  tier: "block",
  category: "identifier",
  message: "This looks like a Social Security number.",
  find: (text) => allMatches(/(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g, text),
};

const phone: PhiRule = {
  id: "phone",
  tier: "block",
  category: "contact",
  message: "This looks like a telephone number.",
  find: (text) => [
    // (555) 867-5309
    ...allMatches(/\(\d{3}\)\s?\d{3}[-.\s]\d{4}(?!\d)/g, text),
    // 555-867-5309, 555.867.5309 — separators required, so a list of counts
    // separated by spaces is not mistaken for a phone number.
    ...allMatches(/(?<![\d-])\d{3}[-.]\d{3}[-.]\d{4}(?![\d-])/g, text),
    // +1 555 867 5309
    ...allMatches(/(?<!\d)\+?1[-.\s]\d{3}[-.\s]\d{3}[-.\s]\d{4}(?!\d)/g, text),
  ],
};

const longDigits: PhiRule = {
  id: "long_digits",
  tier: "block",
  category: "identifier",
  message: "A run of nine or more digits looks like an identifier.",
  find: (text) => allMatches(digitRun(9), text),
};

/**
 * Identifier keywords. `records?` and `accounts?` are ordinary English words,
 * which is why this rule alone uses a distance window rather than immediate
 * adjacency.
 */
const IDENTIFIER_KEYWORDS = /\b(?:mrn|dob|acct|accounts?|accession|records?)\b|\bd\.o\.b\.?/gi;
const KEYWORD_WINDOW = 30;

const identifierDigits: PhiRule = {
  id: "identifier_digits",
  tier: "block",
  category: "identifier",
  message:
    "A number of six or more digits next to an identifier word (MRN, DOB, account, accession, record) looks like a patient identifier.",
  find: (text) => {
    const keywords = allMatches(IDENTIFIER_KEYWORDS, text);
    if (keywords.length === 0) return [];
    return allMatches(digitRun(6), text).filter(([start, end]) =>
      keywords.some(([kStart, kEnd]) => {
        const gap = kEnd <= start ? start - kEnd : end <= kStart ? kStart - end : 0;
        return gap <= KEYWORD_WINDOW;
      }),
    );
  },
};

/**
 * ADDITION to the approved tiering — flagged in docs/SECURITY.md and in the
 * phase 2 report for the committee to confirm.
 *
 * As written, the tiering lets "DOB: 03/14/1962" and "MRN 12-345-678" through
 * as warn-only, because neither contains an unbroken run of six digits. Both
 * are unambiguous identifiers. This rule blocks a strongly identifying keyword
 * IMMEDIATELY followed by a digit sequence of six or more digits with single
 * separators.
 *
 * It deliberately excludes the plain words "record" and "account" unless they
 * are followed by "number", "no." or "#", because "the health record
 * 2025-2026 upgrade" is ordinary prose and a block has no override.
 */
const IDENTIFIER_SEQUENCE =
  /(?:\bmrn\b|\bdob\b|\bd\.o\.b\.?|\bacct\b|\baccession\b|\b(?:record|account)\s*(?:number|no\.?|#))\s*(?:#|no\.?|number)?\s*[:#=]?\s*(\d(?:[\s./-]?\d){5,})/dgi;

const identifierSequence: PhiRule = {
  id: "identifier_sequence",
  tier: "block",
  category: "identifier",
  message:
    "An identifier word (MRN, DOB, accession, account number) followed directly by a number looks like a patient identifier or date of birth.",
  find: (text) => {
    const spans: Array<[number, number]> = [];
    for (const match of text.matchAll(IDENTIFIER_SEQUENCE)) {
      const group = match.indices?.[1];
      if (group) spans.push([group[0], group[1]]);
    }
    return spans;
  },
};

// ---------------------------------------------------------------- warn

const digits6to8: PhiRule = {
  id: "digits_6_to_8",
  tier: "warn",
  category: "identifier",
  message: "A six-to-eight digit number could be an identifier. Check it is a count, not a record number.",
  find: (text) => allMatches(digitRun(6, 8), text),
};

/**
 * Month names are matched case-sensitively, with an initial capital, so that
 * "a team of 2 may choose" is not read as a date.
 */
const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const ORD = "(?:st|nd|rd|th)?";

/**
 * Dates that carry a DAY. A month and year alone — "Jan 2025 – Jun 2025",
 * "July 2025", "Q3 FY2026" — describe a measurement period, not an event in a
 * person's care, and are not flagged. This is what lets "baseline Jan 2025 –
 * Jun 2025, n = 412" pass clean, as the approved false-positive suite requires.
 */
const date: PhiRule = {
  id: "date",
  tier: "warn",
  category: "date",
  message: "A full date could identify when something happened to a patient.",
  find: (text) => [
    // 03/14/2025, 14-03-25, 3.14.2025
    ...allMatches(/(?<![\d/.-])\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})(?![\d/.-])/g, text),
    // 2025-03-14
    ...allMatches(/(?<![\d-])\d{4}-\d{1,2}-\d{1,2}(?![\d-])/g, text),
    // 14 March 2025, 1st Oct 2024
    ...allMatches(new RegExp(`\\b\\d{1,2}${ORD}\\s+${MONTH}\\.?,?\\s+\\d{2,4}\\b`, "g"), text),
    // March 14, 2025
    ...allMatches(new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}${ORD},?\\s+\\d{4}\\b`, "g"), text),
    // 14-Mar-2025
    ...allMatches(new RegExp(`\\b\\d{1,2}-${MONTH}-\\d{2,4}\\b`, "g"), text),
    // March 14 (no year). `\\b` after the day stops "Jan 2025" matching as "Jan 20".
    ...allMatches(new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}${ORD}\\b`, "g"), text),
    // 14 March (no year)
    ...allMatches(new RegExp(`\\b\\d{1,2}${ORD}\\s+${MONTH}\\b`, "g"), text),
  ],
};

const roomBed: PhiRule = {
  id: "room_bed",
  tier: "warn",
  category: "location",
  message: "A room or bed number can locate a specific patient.",
  // Keyword FOLLOWED by a number: "bed 14", "Room 412B". "32-bed ward" and
  // "per 1,000 bed days" put the number before the word and are not flagged.
  find: (text) => allMatches(/\b(?:room|rm|bed)\s*#?\s*\d+[A-Za-z]?\b/gi, text),
};

/**
 * Capitalised two-word sequences following "patient", "Mr.", "Mrs.", "Ms." or
 * "Dr.". Name words must be capitalised (case-sensitive); the title may omit
 * its full stop, since "Mr Smith" is common outside the United States.
 *
 * After "patient", a committee-maintained stop list suppresses ordinary
 * phrases: "the Patient Safety Committee" is not a name.
 */
// Starts with a capital and ends lowercase, with apostrophes, hyphens and
// inner capitals allowed: Smith, O'Brien, McDonald, Gonzalez-Ruiz. Ending
// lowercase keeps acronyms such as ICU or GMEC from reading as names.
const NAME_WORD = "[A-Z][A-Za-z'’-]*[a-z]";
const NAME_AFTER_TITLE = new RegExp(
  `(\\b[Pp]atient|\\bM(?:rs?|s)\\.?|\\bDr\\.?)\\s+(${NAME_WORD})\\s+(${NAME_WORD})`,
  "dg",
);

const nameAfterTitle: PhiRule = {
  id: "name_after_title",
  tier: "warn",
  category: "name",
  message: "A capitalised name after a title or after the word 'patient' could identify a person.",
  find: (text, context: RuleContext) => {
    const spans: Array<[number, number]> = [];
    for (const match of text.matchAll(NAME_AFTER_TITLE)) {
      const title = match[1] ?? "";
      const firstWord = match[2] ?? "";
      if (/^patient$/i.test(title) && context.nameContextStopWords.has(firstWord)) continue;
      const first = match.indices?.[2];
      const second = match.indices?.[3];
      if (first && second) spans.push([first[0], second[1]]);
    }
    return spans;
  },
};

/**
 * The floor. Order matters only for readability; overlapping flags are
 * resolved in scan.ts, most severe first.
 */
export const BUILT_IN_RULES: readonly PhiRule[] = [
  ssn,
  phone,
  longDigits,
  identifierDigits,
  identifierSequence,
  digits6to8,
  date,
  roomBed,
  nameAfterTitle,
];

/** Rule ids that can never be disabled, for the config loader to check. */
export const FLOOR_RULE_IDS: ReadonlySet<string> = new Set(BUILT_IN_RULES.map((r) => r.id));
