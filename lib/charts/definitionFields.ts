/**
 * The operational definition's seven parts, their labels and the "what is
 * missing" check. No zod here: this module is shipped to the browser for the
 * builder's checklist, and the schema lives in definition.ts on the server.
 */

export const CADENCES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "annual"] as const;
export type Cadence = (typeof CADENCES)[number];

export const CADENCE_LABELS: Record<Cadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

export type DefinitionField = "numerator" | "denominator" | "inclusions" | "exclusions" | "dataSource" | "puller" | "cadence";

export const DEFINITION_FIELDS: ReadonlyArray<{
  id: DefinitionField;
  label: string;
  help: string;
  placeholder: string;
}> = [
  {
    id: "numerator",
    label: "Numerator",
    help: "Exactly what counts. Name the time window and any threshold: “signed more than 48 hours after the recorded discharge time”, not “late”.",
    placeholder: "Discharge summaries with a signature timestamp more than 48 hours after discharge",
  },
  {
    id: "denominator",
    label: "Denominator",
    help: "Everything that could have been counted. For a count over a constant period, write “Not applicable” and say why.",
    placeholder: "All discharge summaries for patients discharged from the service in the month",
  },
  {
    id: "inclusions",
    label: "Inclusions",
    help: "Who or what is in scope: service, unit, age, encounter type.",
    placeholder: "Adult inpatients discharged from the Hospitalist service",
  },
  {
    id: "exclusions",
    label: "Exclusions",
    help: "Who or what is left out, and why. Write “None” if nothing is excluded — an empty field reads as “not thought about”.",
    placeholder: "Deaths; transfers to another acute facility",
  },
  {
    id: "dataSource",
    label: "Data source",
    help: "The report, table or system the numbers come from.",
    placeholder: "EHR documentation report DSR-114",
  },
  {
    id: "puller",
    label: "Who pulls it",
    help: "A role, or a role and a name. If only one person knows how, the project stalls when they move on.",
    placeholder: "Decision Support analyst",
  },
  {
    id: "cadence",
    label: "Cadence",
    help: "How often a point is plotted.",
    placeholder: "",
  },
];

/** Fields not yet filled in, for the builder's checklist. Mirrors the schema's rule. */
export function missingFields(draft: Partial<Record<DefinitionField, string | null | undefined>>): DefinitionField[] {
  return DEFINITION_FIELDS.map((f) => f.id).filter((id) => {
    const value = (draft[id] ?? "").trim();
    return id === "cadence" ? !(CADENCES as readonly string[]).includes(value) : value.length < 3;
  });
}
