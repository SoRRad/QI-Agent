import type { EventType } from "@/lib/generated/prisma/client";
import { MAX_TOTAL, RUBRIC, SCORE_MAX, SCORE_MIN } from "./rubric";

/**
 * Event kits (§6.6): agenda, invitation, slide skeleton, judging rubric and
 * feedback form, filled from the record by templates — no model.
 *
 * Nothing here states a time, a room or a rule the record does not hold. The
 * agenda is an order of business, not a timetable, and each section says what
 * the organiser still has to fill in. A kit is generated on request and stored
 * as it was generated, so what went out in an invitation stays on record even
 * after the submissions change; the page says when it is out of date.
 */

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  symposium: "Symposium",
  committee_meeting: "Committee meeting",
  workshop: "Workshop",
  cler_mock: "Mock CLER walkaround",
};

export interface KitEvent {
  title: string;
  type: EventType;
  date: Date;
  quarter: string;
  agenda: string | null;
}

export interface KitSubmission {
  title: string;
  program: string;
  presenters: string;
}

export interface KitSection {
  id: "agenda" | "invitation" | "slides" | "rubric" | "feedback";
  heading: string;
  body: string;
}

const TO_FILL = "[organiser to fill: ";
const fill = (what: string) => `${TO_FILL}${what}]`;

export function eventDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function agenda(event: KitEvent, submissions: readonly KitSubmission[]): string {
  const items: string[] = [];
  switch (event.type) {
    case "symposium":
      items.push("Welcome, and the committee's quarter in review");
      if (submissions.length) {
        items.push("Presentations, in this order:");
        submissions.forEach((s, i) => items.push(`   ${i + 1}. ${s.title} — ${s.presenters} (${s.program})`));
      } else {
        items.push(`Presentations ${fill("no submissions recorded yet")}`);
      }
      items.push("Poster session while the judges score");
      items.push("Results, with any shared places announced as shared");
      items.push("What the committee changed this quarter, and close");
      break;
    case "committee_meeting":
      items.push("Stalled projects and unaccepted handoffs");
      items.push("Barriers raised through the pulse survey, and decisions due");
      items.push("The headline measure: what the run chart shows since the last meeting");
      items.push("Questions Ask could not answer: documents the institution owes");
      items.push("Actions, owners and dates");
      break;
    case "workshop":
      items.push(`Purpose of the session ${fill("one sentence")}`);
      items.push("Worked example from an archived project");
      items.push("Hands-on: participants draft or critique their own");
      items.push("What to do next week, and where to get help");
      break;
    case "cler_mock":
      items.push("Briefing for interviewers: the six focus areas, and how to rate an answer");
      items.push(`The walkaround ${fill("units to visit")}`);
      items.push("Recording responses in QI Agent as they are given, by role, never by name");
      items.push("Debrief: the gap reading by focus area, and who follows up each gap");
      break;
  }
  const lines = items.map((item) => (item.startsWith("   ") ? item : `- ${item}`));
  return [...lines, "", `Location and timings: ${fill("room, start and finish times")}`, ...(event.agenda ? ["", `Notes on record: ${event.agenda}`] : [])].join("\n");
}

function invitation(event: KitEvent, submissions: readonly KitSubmission[]): string {
  const when = eventDate(event.date);
  const body: Record<EventType, string> = {
    symposium: `Residents, fellows and faculty are invited to ${event.title} on ${when}. Trainee teams will present improvement work from across the institution${submissions.length ? `, including ${submissions.length === 1 ? "one project" : `${submissions.length} projects`}` : ""}. Come to hear what worked, what did not, and what the committee changed as a result.`,
    committee_meeting: `Members of the quality improvement committee are invited to ${event.title} on ${when}. Please review the stalled queue and the barriers log in QI Agent beforehand.`,
    workshop: `Residents and fellows are invited to ${event.title} on ${when}. Bring a project you are working on, or one you are thinking about.`,
    cler_mock: `Program leaders and interviewers are invited to ${event.title} on ${when}. Interviewers will ask residents and fellows open questions about patient safety, quality, care transitions, supervision, well-being and professionalism, as a CLER visit would. Answers are recorded by role, never by name.`,
  };
  return [`Subject: ${event.title} — ${when}`, "", body[event.type], "", `Where: ${fill("room")}`, `Time: ${fill("start and finish")}`, `Reply to: ${fill("contact")}`].join("\n");
}

function slides(event: KitEvent, submissions: readonly KitSubmission[]): string {
  const deck = [`1. Title — ${event.title}, ${eventDate(event.date)}`];
  if (event.type === "symposium") {
    deck.push("2. The quarter in review — the headline run chart, annotated");
    deck.push("", "Each presenting team (one slide each, in this order):");
    for (const [i, heading] of [
      "Problem and aim",
      "Measures, with operational definitions",
      "Changes tested (PDSA), with predictions",
      "Results — annotated run or control chart",
      "What we learned, and who sustains it",
    ].entries()) {
      deck.push(`   ${String.fromCharCode(97 + i)}. ${heading}`);
    }
    if (submissions.length) deck.push("", `Teams: ${submissions.map((s) => s.title).join("; ")}.`);
    deck.push("", "Last: results, and what the committee changed this quarter.");
  } else if (event.type === "cler_mock") {
    deck.push("2. The six CLER focus areas", "3. How to rate an answer: clearly, partly, or could not answer", "4. Debrief: gap reading by focus area");
  } else if (event.type === "committee_meeting") {
    deck.push("2. Headline measure run chart", "3. Stalled queue", "4. Barriers and decisions due", "5. Actions");
  } else {
    deck.push(`2. ${fill("learning objectives")}`, "3. Worked example", "4. Exercise", "5. Next steps");
  }
  return deck.join("\n");
}

function rubric(): string {
  return [
    `Score each criterion from ${SCORE_MIN} to ${SCORE_MAX}; the weight multiplies the score. The maximum total is ${MAX_TOTAL}.`,
    "",
    ...RUBRIC.map((c) => `- ${c.label} (weight ${c.weight}): ${c.anchor}`),
    "",
    "A submission's result is the mean of its judges' totals. Judges never score a project they coach or lead. Tied results share a place: the committee, not the software, decides whether to break a tie.",
  ].join("\n");
}

function feedback(event: KitEvent): string {
  const questions = [
    "What is one thing from today you will use in your own work?",
    "What should we change for next time?",
    event.type === "symposium" ? "Which presentation taught you the most, and why?" : "Was anything unclear?",
    "Is there a barrier to improvement work you would like the committee to know about? (You can also report it anonymously in the quarterly pulse survey.)",
  ];
  return ["Anonymous. Please do not include any patient information.", "", ...questions.map((q, i) => `${i + 1}. ${q}`)].join("\n");
}

export function buildKit(event: KitEvent, submissions: readonly KitSubmission[]): KitSection[] {
  const sections: KitSection[] = [
    { id: "agenda", heading: "Agenda", body: agenda(event, submissions) },
    {
      id: "invitation",
      heading: "Invitation",
      body: invitation(event, submissions),
    },
    {
      id: "slides",
      heading: "Slide skeleton",
      body: slides(event, submissions),
    },
  ];
  if (event.type === "symposium") sections.push({ id: "rubric", heading: "Judging rubric", body: rubric() });
  sections.push({
    id: "feedback",
    heading: "Feedback form",
    body: feedback(event),
  });
  return sections;
}

/** Stored form: one Markdown string per section, "## Heading" first. */
export function serialiseKit(sections: readonly KitSection[]): string[] {
  return sections.map((s) => `## ${s.heading}\n\n${s.body}`);
}

export function parseKit(stored: unknown): Array<{ heading: string; body: string }> {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((s): s is string => typeof s === "string")
    .map((s) => {
      const [first, ...rest] = s.split("\n");
      return {
        heading: (first ?? "").replace(/^##\s*/, ""),
        body: rest.join("\n").trim(),
      };
    });
}

export function kitMarkdown(title: string, stored: unknown): string {
  return [`# ${title} — event kit`, "", ...parseKit(stored).flatMap((s) => [`## ${s.heading}`, "", s.body, ""])].join("\n");
}
