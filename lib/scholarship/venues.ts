import { z } from "zod";
import raw from "@/content/venues.json";

/**
 * The meeting and journal list (§6.5), maintained by the committee in
 * /content/venues.json and validated here when it loads: a malformed edit
 * fails the test suite rather than the page a trainee is looking at.
 *
 * The file is imported, not read at runtime, so it ships with the build on
 * Vercel and in the Docker image alike. Editing it is a commit, which is also
 * how the committee's quarterly review leaves a record.
 */

const base = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(3),
  abstractWordLimit: z.number().int().min(50).max(1000),
  structuredAbstract: z.boolean(),
  headings: z.array(z.string().min(2)).min(2).optional(),
  scope: z.array(z.string().min(2)).min(1),
  notes: z.string().optional(),
  isLocal: z.boolean().optional(),
};

const journal = z.object({ ...base, type: z.literal("journal"), deadline: z.literal("rolling"), wordLimit: z.number().int().min(500).max(10000) });
const meeting = z.object({ ...base, type: z.literal("meeting"), deadlineMonth: z.number().int().min(1).max(12) });

export const venuesFileSchema = z.object({
  note: z.string(),
  lastReviewed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  journals: z.array(z.union([journal, meeting])),
  meetings: z.array(z.union([journal, meeting])),
});

export type Venue = z.infer<typeof journal> | z.infer<typeof meeting>;

const parsed = venuesFileSchema.parse(raw);

export const VENUES_LAST_REVIEWED = parsed.lastReviewed;
export const VENUES: readonly Venue[] = [...parsed.meetings, ...parsed.journals];

export function venueById(id: string): Venue | undefined {
  return VENUES.find((v) => v.id === id);
}

/**
 * The headings an abstract for this venue uses. The file names headings for
 * most meetings; where it does not, a structured abstract gets the common
 * four and says so, rather than presenting a guess as the venue's rule.
 */
export function abstractHeadings(venue: Venue): { headings: string[]; fromVenue: boolean } {
  if (!venue.structuredAbstract) return { headings: ["Abstract"], fromVenue: true };
  if (venue.headings) return { headings: venue.headings, fromVenue: true };
  return { headings: ["Background", "Methods", "Results", "Conclusions"], fromVenue: false };
}

// ---------------------------------------------------------------- deadlines

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface Deadline {
  /** "rolling", or the month the deadline usually falls in. */
  label: string;
  /** Whole months until the deadline month starts; 0 means this month. Null when rolling. */
  monthsAway: number | null;
}

/** The next occurrence of a deadline month, counted from `today`. The day is not known, so this month counts as 0. */
export function nextDeadline(venue: Venue, today: Date): Deadline {
  if (venue.type === "journal") return { label: "Rolling submission", monthsAway: null };
  const month = today.getUTCMonth() + 1;
  const monthsAway = (venue.deadlineMonth - month + 12) % 12;
  const year = today.getUTCFullYear() + (venue.deadlineMonth < month ? 1 : 0);
  return { label: `Usually in ${MONTHS[venue.deadlineMonth - 1]} ${year}`, monthsAway };
}

// ---------------------------------------------------------------- matching

export interface ProjectProfile {
  status: string;
  specialty: string;
  clerDomain: string | null;
  /** The most points on any one measure. */
  dataPoints: number;
  completedCycles: number;
}

export type Fit = "fits" | "stretch" | "check" | "excluded";

export interface ScopeReading {
  tag: string;
  fit: Fit;
  reason: string;
}

const finished = (p: ProjectProfile) => p.status === "complete" || p.status === "archived";
const paediatric = (p: ProjectProfile) => /p(a)?ediatric/i.test(p.specialty);

/**
 * How each scope tag in venues.json reads against a project. The project is
 * always trainee-led GME improvement work at one institution, which settles
 * several tags; the rest depend on its record. A tag this table does not know
 * is shown as "check" — the committee can add a tag to the file before
 * teaching this table about it, and nothing breaks.
 */
const SCOPE_RULES: Record<string, (p: ProjectProfile) => { fit: Fit; reason: string }> = {
  "any stage": () => ({ fit: "fits", reason: "Takes work at any stage." }),
  "in-progress acceptable": (p) =>
    finished(p) ? { fit: "fits", reason: "Takes finished work too." } : { fit: "fits", reason: "Takes work in progress, so a project still collecting data can go." },
  "improvement report": (p) =>
    finished(p) ? { fit: "fits", reason: "Publishes improvement reports, and this project is finished." } : { fit: "stretch", reason: "Publishes improvement reports of finished work; better once this project has results that have held." },
  "SQUIRE-aligned": () => ({ fit: "fits", reason: "Expects SQUIRE 2.0, which the drafter follows." }),
  "single-site acceptable": () => ({ fit: "fits", reason: "Accepts single-site work." }),
  "GME context": () => ({ fit: "fits", reason: "About graduate medical education, which trainee-led QI is." }),
  GME: () => ({ fit: "fits", reason: "About graduate medical education." }),
  "trainee-led": () => ({ fit: "fits", reason: "Interested in trainee-led work." }),
  "programme-level": () => ({ fit: "fits", reason: "Takes programme-level work." }),
  "CLER-relevant": (p) =>
    p.clerDomain ? { fit: "fits", reason: "Looks for CLER-relevant work, and this project names a CLER focus area." } : { fit: "check", reason: "Looks for CLER-relevant work; this project has no CLER focus area recorded." },
  "educational outcomes": () => ({ fit: "check", reason: "Wants educational outcomes — a fit only if the project measured what trainees learned or did differently." }),
  "educational contribution": () => ({ fit: "check", reason: "Wants a contribution to education rather than to clinical care." }),
  curriculum: () => ({ fit: "check", reason: "Interested in curriculum work." }),
  "GME policy": () => ({ fit: "check", reason: "Interested in GME policy." }),
  "academic medicine": () => ({ fit: "fits", reason: "Covers academic medicine broadly." }),
  education: () => ({ fit: "check", reason: "Focused on education." }),
  "health care quality": () => ({ fit: "fits", reason: "Covers health care quality." }),
  "systems improvement": () => ({ fit: "fits", reason: "Covers systems improvement." }),
  "improvement science": () => ({ fit: "fits", reason: "Covers improvement science." }),
  "all settings": () => ({ fit: "fits", reason: "Takes work from any setting." }),
  "generalisable findings": () => ({ fit: "stretch", reason: "Wants findings that transfer beyond one site, which a single-site project has to argue for." }),
  "multi-site": () => ({ fit: "stretch", reason: "Prefers multi-site work." }),
  "methodological contribution": () => ({ fit: "stretch", reason: "Values a methodological contribution." }),
  "paediatric setting": (p) => (paediatric(p) ? { fit: "fits", reason: "Paediatric setting, like this project." } : { fit: "excluded", reason: "Paediatric settings only." }),
  "specialty-specific": () => ({ fit: "fits", reason: "Specialty society meeting: confirm which society covers this project." }),
  "trainee-only competition": () => ({ fit: "fits", reason: "A competition for trainees." }),
};

export function readScope(tag: string, profile: ProjectProfile): ScopeReading {
  const rule = SCOPE_RULES[tag];
  return rule ? { tag, ...rule(profile) } : { tag, fit: "check", reason: "Check the venue's own description." };
}

export interface VenueMatch {
  venue: Venue;
  deadline: Deadline;
  readings: ScopeReading[];
  /** Overall: excluded if any tag excludes; otherwise the weakest reading. */
  fit: Fit;
  /** Why this venue is ranked where it is, first reason first. */
  summary: string;
}

const ORDER: Record<Fit, number> = { fits: 0, check: 1, stretch: 2, excluded: 3 };

export function matchVenues(profile: ProjectProfile, today: Date, venues: readonly Venue[] = VENUES): VenueMatch[] {
  return venues
    .map((venue) => {
      const readings = venue.scope.map((tag) => readScope(tag, profile));
      const fit = readings.reduce<Fit>((worst, r) => (ORDER[r.fit] > ORDER[worst] ? r.fit : worst), "fits");
      const deadline = nextDeadline(venue, today);
      const lead = readings.find((r) => r.fit === fit) ?? readings[0]!;
      return { venue, deadline, readings, fit, summary: lead.reason };
    })
    .sort(
      (a, b) =>
        ORDER[a.fit] - ORDER[b.fit] ||
        // Among equal fits, the nearest deadline first: deadlines are the
        // binding constraint (library: SQUIRE outline).
        (a.deadline.monthsAway ?? 99) - (b.deadline.monthsAway ?? 99) ||
        a.venue.name.localeCompare(b.venue.name),
    );
}
