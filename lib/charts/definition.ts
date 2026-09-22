import { z } from "zod";
import { CADENCES } from "./definitionFields";

export { CADENCE_LABELS, CADENCES, DEFINITION_FIELDS, missingFields } from "./definitionFields";
export type { Cadence, DefinitionField } from "./definitionFields";

/**
 * The operational definition: the seven things another resident needs to
 * reproduce a measure without asking anyone (brief §6.3). The builder refuses
 * to save until every one is present — enforced here, in the schema the server
 * action parses with, not only by the disabled button.
 */

const text = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(3, `${label} is required.`)
    .max(2000, `${label} must be under 2,000 characters.`);

export const definitionSchema = z.object({
  numerator: text("Numerator"),
  denominator: text("Denominator"),
  inclusions: text("Inclusions"),
  exclusions: text("Exclusions"),
  dataSource: text("Data source"),
  puller: text("Who pulls it"),
  cadence: z.enum(CADENCES, { error: "Cadence is required." }),
});

export type DefinitionInput = z.infer<typeof definitionSchema>;
