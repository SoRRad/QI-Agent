/**
 * The five-element aim standard, as a deterministic check.
 *
 * The same function backs the intake validator, the aim critique rubric,
 * tutor mode and devil's advocate, so "is this aim complete?" has exactly one
 * answer in the system — and it is never a model's opinion. The elements are
 * the ones in content/library/aim-statement-standard.md, and
 * tests/aim/validate.test.ts runs the passing and failing examples FROM THAT
 * DOCUMENT through this function. If the committee edits the examples, the
 * test tells them whether the validator still agrees.
 *
 * Structured fields, when present, are authoritative: an aim written in the
 * intake wizard has a numeric target field, a deadline date field and so on.
 * The text patterns exist for aims written as free prose.
 */

export type AimElement =
  | "direction_magnitude"
  | "baseline"
  | "population"
  | "deadline"
  | "measure_definition";

export const AIM_ELEMENTS: ReadonlyArray<{ element: AimElement; label: string }> = [
  { element: "direction_magnitude", label: "Direction and magnitude, as a number" },
  { element: "baseline", label: "Baseline value, with its measurement period" },
  { element: "population", label: "Population — which patients, unit, service" },
  { element: "deadline", label: "Deadline, as a calendar date" },
  { element: "measure_definition", label: "Measure definition — numerator and denominator" },
];

export interface AimInput {
  text: string;
  baselineValue?: number | null;
  baselinePeriod?: string | null;
  target?: number | null;
  deadline?: Date | null;
  population?: string | null;
  /** The linked outcome measure's current operational definition. */
  measure?: { numerator: string; denominator: string } | null;
}

export interface ElementResult {
  element: AimElement;
  label: string;
  met: boolean;
  /** Plain language: why it is met, or exactly what is missing. */
  reason: string;
}

export interface AimValidation {
  passed: boolean;
  elements: ElementResult[];
  missing: AimElement[];
}

const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/** A date with a day: "30 June 2026", "June 30, 2026", "2026-06-30", "06/30/2026". */
const FULL_DATE = new RegExp(
  [
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+\\d{4}\\b`,
    `\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`,
    `\\b\\d{4}-\\d{1,2}-\\d{1,2}\\b`,
    `\\b\\d{1,2}/\\d{1,2}/\\d{4}\\b`,
  ].join("|"),
);

/** A numeric target: "to 15%", "below 60 minutes", "at least 90%". */
const NUMERIC_TARGET =
  /\b(?:to|below|under|above|over|at\s+least|at\s+most|fewer\s+than|more\s+than|no\s+more\s+than|of)\s+\d+(?:\.\d+)?\s*(?:%|percent|minutes?|hours?|days?|per\b|draws?|\w+)/i;

const VAGUE_DIRECTION = /\b(?:improve|enhance|optimi[sz]e|strengthen|better)\b/i;

/**
 * Who, stated as the units being counted. "Patient safety" is a goal, not a
 * population, so "patient" followed by a goal word does not count.
 */
const POPULATION_NOUN =
  /\b(?:patients|discharges?|admissions?|encounters?|visits?|stays?|referrals?|orders?)\b|\bpatient(?!\s+(?:safety|experience|care|flow|satisfaction|outcomes?|quality)\b)\b/i;
const POPULATION_PLACE =
  /\b(?:service|unit|ward|wards|clinic|department|hospital|team|icu|ed|emergency|floor|practice|program)\b/i;

export function validateAim(input: AimInput): AimValidation {
  const text = input.text ?? "";

  const elements: ElementResult[] = [
    directionMagnitude(input, text),
    baseline(input, text),
    population(input, text),
    deadline(input, text),
    measureDefinition(input, text),
  ];

  const missing = elements.filter((e) => !e.met).map((e) => e.element);
  return { passed: missing.length === 0, elements, missing };
}

const labelOf = (element: AimElement): string =>
  AIM_ELEMENTS.find((e) => e.element === element)?.label ?? element;

function result(element: AimElement, met: boolean, reason: string): ElementResult {
  return { element, label: labelOf(element), met, reason };
}

function directionMagnitude(input: AimInput, text: string): ElementResult {
  if (typeof input.target === "number") {
    return result("direction_magnitude", true, "A numeric target is set.");
  }
  if (NUMERIC_TARGET.test(text)) {
    return result("direction_magnitude", true, "The aim states a numeric target.");
  }
  if (VAGUE_DIRECTION.test(text)) {
    return result(
      "direction_magnitude",
      false,
      "The aim says what should improve but not by how much. \"Improve\" carries no number, so there is nothing to succeed or fail against.",
    );
  }
  return result("direction_magnitude", false, "There is no numeric target: say which way the measure moves, and to what value.");
}

function baseline(input: AimInput, text: string): ElementResult {
  if (typeof input.baselineValue === "number" && input.baselinePeriod) {
    return result("baseline", true, "A baseline value and its measurement period are set.");
  }
  if (typeof input.baselineValue === "number") {
    return result("baseline", false, "There is a baseline value but no period: say over what dates it was measured.");
  }
  const mentionsBaseline = /\bbaseline\b[^.]{0,100}?\d/i.test(text) || /\d[^.]{0,40}\bbaseline\b/i.test(text);
  const hasPeriod = /\b(?:19|20)\d{2}\b|\bQ[1-4]\b|\bFY\s?\d{2,4}\b/i.test(text);
  if (mentionsBaseline && hasPeriod) {
    return result("baseline", true, "The aim states a baseline and the period it covers.");
  }
  return result("baseline", false, "There is no baseline: state the current value and the period over which it was measured.");
}

function population(input: AimInput, text: string): ElementResult {
  if (input.population && input.population.trim().length >= 10) {
    return result("population", true, "The population is stated.");
  }
  if (POPULATION_NOUN.test(text) && POPULATION_PLACE.test(text)) {
    return result("population", true, "The aim names who is counted and where.");
  }
  return result(
    "population",
    false,
    "The population is unclear: name which patients (or encounters), on which unit or service. \"The ICU\" names a place, not who is being counted.",
  );
}

function deadline(input: AimInput, text: string): ElementResult {
  if (input.deadline instanceof Date && !Number.isNaN(input.deadline.getTime())) {
    return result("deadline", true, "A deadline date is set.");
  }
  if (FULL_DATE.test(text)) {
    return result("deadline", true, "The aim states a calendar deadline.");
  }
  if (/\b(?:this|next|the)\s+(?:academic\s+)?(?:year|quarter|rotation|block|semester)\b|\bby\s+the\s+end\b/i.test(text)) {
    return result(
      "deadline",
      false,
      "The deadline is relative (\"this academic year\"), which drifts. Give a calendar date.",
    );
  }
  return result("deadline", false, "There is no deadline: give the calendar date by which the target should be met.");
}

function measureDefinition(input: AimInput, text: string): ElementResult {
  if (input.measure?.numerator?.trim() && input.measure?.denominator?.trim()) {
    return result("measure_definition", true, "The outcome measure has a numerator and a denominator.");
  }
  if (/\bnumerator\b/i.test(text) && /\bdenominator\b/i.test(text)) {
    return result("measure_definition", true, "The aim states a numerator and a denominator.");
  }
  return result(
    "measure_definition",
    false,
    "The measure is not defined: state exactly what is counted (numerator) and out of what (denominator), so two people would get the same number.",
  );
}
