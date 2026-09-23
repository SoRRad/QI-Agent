import { describe, expect, it } from "vitest";
import { parsePhiConfig } from "@/lib/phi/config";
import { scan } from "@/lib/phi/scan";
import type { PhiFlag } from "@/lib/phi/types";

/**
 * The PHI scanner, tested in both directions.
 *
 * THE FALSE-POSITIVE SUITE comes first, because it is the one that decides
 * whether the control is usable. The block tier has no override: a block that
 * fires on ordinary QI prose stops a trainee cold. And a warn that fires on
 * every sentence teaches people to click through it, which is worse than no
 * scanner. If this suite goes noisy, the tiering is wrong — the fix is to
 * report that, not to loosen the block tier.
 */

const DEFAULT = parsePhiConfig(
  {
    version: 1,
    additionalPatterns: [],
    nameContextStopWords: [
      "Access", "Advisory", "Advocacy", "Advocate", "Care", "Centered", "Centred",
      "Council", "Education", "Engagement", "Experience", "Family", "Flow",
      "Logistics", "Outcomes", "Placement", "Portal", "Quality", "Relations",
      "Reported", "Rights", "Safety", "Satisfaction", "Services", "Transfer", "Transport",
    ],
  },
  "test",
);

const run = (text: string, exemptCategories?: PhiFlag["category"][]) =>
  scan(text, exemptCategories ? { exemptCategories } : {}, DEFAULT);

const rules = (flags: PhiFlag[]) => flags.map((f) => `${f.tier}:${f.rule}`);

/** What the flagged characters are — for assertions only; flags never carry text. */
const spans = (text: string, flags: PhiFlag[]) => flags.map((f) => text.slice(f.start, f.end));

// ---------------------------------------------------------------------------

describe("false-positive suite: realistic QI prose must pass clean", () => {
  const CLEAN: readonly string[] = [
    // The two sentences named in the approved tiering (Q7).
    "baseline Jan 2025 – Jun 2025, n = 412",
    "reviewed 1,240 charts across 18 months",
    // Rates, counts and periods.
    "Median length of stay fell from 5.2 to 4.6 days over 24 weeks.",
    "Time to first antibiotic decreased from 94 to 61 minutes on a p-chart of 22 subgroups.",
    "Readmission within 30 days dropped from 18.2% to 14.9% across 3,456 discharges.",
    "Hand hygiene compliance on the medical wards rose from 71% to 89%.",
    "Of 212 eligible encounters, 187 met the sepsis bundle within 3 hours.",
    "Falls per 1,000 patient days fell from 3.1 to 2.2 on the geriatrics unit.",
    "Central line days totalled 14,220 with 9 CLABSI events, or 0.63 per 1,000.",
    "The ICU sepsis screen fired 1,902 times in 2025, and 11.4% were true positives.",
    "Mean door-to-needle time was 52 minutes, down from 67, over 26 fortnights.",
    "Weekend discharges accounted for 38% of late summaries in FY2025.",
    // Words the identifier rules key on, used as ordinary English.
    "Accession volumes in the core lab exceeded 250,000 tests per month.",
    "Medical record review covered 640 admissions from 2023 to 2025.",
    "Account for seasonal variation by freezing the median on the 2024 baseline.",
    "The health record upgrade in 2025-2026 changed where discharge times are stored.",
    // Organisational phrases that start with "Patient".
    "The Patient Safety Committee endorsed the change in Q3 2025.",
    "Patient Experience scores improved after the discharge folder pilot.",
    "We targeted a reduction from 2.3 to 1.4 draws per patient-day.",
    // Staff named without a full two-word name after the title.
    "Dr. Lindqvist coached the team through the second cycle.",
    // Places and teams, not rooms and beds.
    "We ran four PDSA cycles on 6 West and 7 East between Q1 and Q3 FY2026.",
    "Standing orders were retired on the 32-bed surgical ward in July 2025.",
    "Occupancy stayed above 92% of staffed beds for the whole quarter.",
    // Process language.
    "Cycle 2 extended the huddle to all four teams, and uptake reached 46%.",
    "The balancing measure, documentation time, rose by 1.4 minutes per discharge.",
    "Interpreter use was stratified by preferred language across 2,048 calls.",
    "The analyst pulled report DSR-114 for all 1,337 Hospitalist discharges.",
    "CLER domain: care transitions; escalated to GMEC for the 2026 academic year.",
    "Version 2 of the aim statement replaced version 1 after coach review.",
  ];

  it(`contains at least twenty sentences (has ${CLEAN.length})`, () => {
    expect(CLEAN.length).toBeGreaterThanOrEqual(20);
  });

  for (const sentence of CLEAN) {
    it(`passes clean: "${sentence}"`, () => {
      const flags = run(sentence);
      expect(
        flags.map((f) => `${f.rule} on "${sentence.slice(f.start, f.end)}"`),
        "any flag here means the tiering is too noisy",
      ).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------

describe("block tier", () => {
  it("blocks an SSN shape", () => {
    const text = "SSN 123-45-6789 on file";
    const flags = run(text);
    expect(rules(flags)).toEqual(["block:ssn"]);
    expect(spans(text, flags)).toEqual(["123-45-6789"]);
  });

  it("blocks telephone shapes with separators", () => {
    for (const text of ["call (555) 867-5309", "call 555-867-5309", "call 555.867.5309", "call +1 555 867 5309"]) {
      expect(rules(run(text)), text).toContain("block:phone");
    }
  });

  it("does not read a list of space-separated counts as a phone number", () => {
    expect(run("teams saw 212 187 3456 patients")).not.toContainEqual(
      expect.objectContaining({ rule: "phone" }),
    );
  });

  it("blocks any run of nine or more digits", () => {
    const text = "ref 123456789 attached";
    expect(rules(run(text))).toEqual(["block:long_digits"]);
  });

  it("does not treat a long decimal fraction as an identifier", () => {
    expect(run("p = 0.0000012345")).toEqual([]);
  });

  it("blocks six or more digits within 30 characters of an identifier word", () => {
    for (const [text, span] of [
      ["MRN 00123456", "00123456"],
      ["the patient's DOB was recorded as 196203", "196203"],
      ["accession 7788990 from the lab", "7788990"],
      ["acct 445566 was billed", "445566"],
      ["123456 is the medical record number", "123456"],
    ] as const) {
      const flags = run(text);
      expect(rules(flags), text).toContain("block:identifier_digits");
      expect(spans(text, flags), text).toContain(span);
    }
  });

  it("reports one block, not a block plus a warning, for the same characters", () => {
    // 00123456 is also a six-to-eight digit run. The block wins and the warn
    // for the identical span is dropped.
    expect(rules(run("MRN 00123456"))).toEqual(["block:identifier_digits"]);
  });

  describe("ADDITION: identifier word immediately followed by a separated number", () => {
    it("blocks a date of birth", () => {
      const text = "DOB: 03/14/1962";
      const flags = run(text);
      expect(rules(flags)).toContain("block:identifier_sequence");
      expect(spans(text, flags)).toContain("03/14/1962");
      // And it is ONE flag: the block covers the date warn for the same span.
      expect(flags.filter((f) => f.tier === "warn")).toEqual([]);
    });

    it("blocks a hyphenated MRN", () => {
      expect(rules(run("MRN 12-345-678"))).toContain("block:identifier_sequence");
    });

    it("blocks 'record number' and 'account #' forms", () => {
      expect(rules(run("record number 44-1122-3"))).toContain("block:identifier_sequence");
      expect(rules(run("account # 123 456"))).toContain("block:identifier_sequence");
    });

    it("does not block the ordinary words 'record' and 'account' before a year range", () => {
      // Covered in the false-positive suite too; asserted here against this
      // rule specifically because it is the one most at risk.
      expect(run("the health record 2025-2026 upgrade")).toEqual([]);
      expect(run("account 2025-2026 figures")).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------

describe("warn tier", () => {
  it("warns on a bare six-to-eight digit number", () => {
    const text = "reference 1234567 in the log";
    expect(rules(run(text))).toEqual(["warn:digits_6_to_8"]);
  });

  it("does not warn on a comma-grouped count", () => {
    expect(run("1,234,567 lab results")).toEqual([]);
  });

  it("warns on full dates in the common formats", () => {
    for (const [text, span] of [
      ["admitted 03/14/2025", "03/14/2025"],
      ["seen 3-14-25 in clinic", "3-14-25"],
      ["discharged 2025-03-14", "2025-03-14"],
      ["on 14 March 2025", "14 March 2025"],
      ["on March 14, 2025", "March 14, 2025"],
      ["on 14-Mar-2025", "14-Mar-2025"],
      ["seen on March 14", "March 14"],
      ["seen on 14 March", "14 March"],
      ["the 1st Oct 2024 visit", "1st Oct 2024"],
    ] as const) {
      const flags = run(text);
      expect(rules(flags), text).toEqual(["warn:date"]);
      expect(spans(text, flags), text).toEqual([span]);
    }
  });

  it("does not read the verb 'may' as a month", () => {
    expect(run("a team of 2 may choose either option")).toEqual([]);
  });

  it("warns on a room or bed number", () => {
    for (const text of ["moved to room 412B", "Bed 14 was cleaned", "rm 3 on the unit"]) {
      expect(rules(run(text)), text).toEqual(["warn:room_bed"]);
    }
  });

  it("warns on a capitalised two-word name after a title or 'patient'", () => {
    for (const [text, span] of [
      ["Mr. John Smith was readmitted", "John Smith"],
      ["Mrs. Ana Oliveira called", "Ana Oliveira"],
      ["Ms. Priya Nair agreed", "Priya Nair"],
      ["Dr. Sarah Lindqvist reviewed it", "Sarah Lindqvist"],
      ["Mr John O'Brien", "John O'Brien"],
      ["Dr. Angus McDonald", "Angus McDonald"],
      ["the patient Maria Gonzalez-Ruiz", "Maria Gonzalez-Ruiz"],
      ["Patient Maria Gonzalez at triage", "Maria Gonzalez"],
    ] as const) {
      const flags = run(text);
      expect(rules(flags), text).toEqual(["warn:name_after_title"]);
      expect(spans(text, flags), text).toEqual([span]);
    }
  });

  it("does not read an acronym after a title as a name", () => {
    expect(run("the patient ICU GMEC review")).toEqual([]);
  });

  it("does not suppress a real name because it follows a title rather than 'patient'", () => {
    // The stop list applies only after "patient". "Dr. Care Smith" is odd,
    // but it is a name after a title and is flagged.
    expect(rules(run("Dr. Care Smith"))).toEqual(["warn:name_after_title"]);
  });
});

// ---------------------------------------------------------------------------

describe("field exemptions", () => {
  it("skips name patterns for a structured staff-name field", () => {
    expect(run("Dr. Hannah Vasquez, Hospitalist Medical Director", ["name"])).toEqual([]);
  });

  it("still blocks an identifier in a name-exempt field", () => {
    // An SSN in the clinical owner field is still an SSN.
    expect(rules(run("Dr. Hannah Vasquez 123-45-6789", ["name"]))).toEqual(["block:ssn"]);
  });

  it("skips date patterns for a date-exempt field", () => {
    const aim =
      "Reduce the proportion signed late from 34% (baseline, 1 October 2024 – 30 September 2025) to 15% by 30 June 2027.";
    expect(rules(run(aim))).toEqual(["warn:date", "warn:date", "warn:date"]);
    expect(run(aim, ["date"])).toEqual([]);
  });

  it("never lets a date exemption hide a date of birth", () => {
    // identifier_sequence is a block-tier identifier rule, so the date
    // exemption cannot switch it off.
    expect(rules(run("DOB 03/14/1962", ["date"]))).toContain("block:identifier_sequence");
  });
});

// ---------------------------------------------------------------------------

describe("flags never carry the matched text", () => {
  it("returns offsets and a message, and nothing else that could hold PHI", () => {
    const text = "SSN 123-45-6789, Mr. John Smith, admitted 03/14/2025";
    for (const flag of run(text)) {
      expect(Object.keys(flag).sort()).toEqual(["category", "end", "message", "rule", "start", "tier"]);
      expect(flag.message).not.toContain("123-45-6789");
      expect(flag.message).not.toContain("John");
      expect(flag.message).not.toContain("03/14");
    }
  });
});

// ---------------------------------------------------------------------------

describe("committee extensions", () => {
  it("adds a pattern from the config file", () => {
    const config = parsePhiConfig({
      version: 1,
      additionalPatterns: [
        {
          id: "nhs_number",
          tier: "block",
          category: "identifier",
          pattern: "\\b\\d{3} \\d{3} \\d{4}\\b",
          message: "This looks like an NHS number.",
        },
      ],
    });
    expect(config.error).toBeNull();
    expect(rules(scan("NHS 943 476 5919", {}, config))).toContain("block:nhs_number");
  });

  it("refuses to redefine a built-in rule", () => {
    const config = parsePhiConfig({
      version: 1,
      additionalPatterns: [
        { id: "ssn", tier: "warn", category: "identifier", pattern: "x", message: "weaker ssn" },
      ],
    });
    expect(config.error).toMatch(/built-in rule and cannot be redefined/);
    // And the floor still applies in full.
    expect(rules(scan("SSN 123-45-6789", {}, config))).toEqual(["block:ssn"]);
  });

  it("rejects a pattern that could hang the server", () => {
    const config = parsePhiConfig({
      version: 1,
      additionalPatterns: [
        { id: "evil", tier: "warn", category: "other", pattern: "(a+)+b", message: "x" },
      ],
    });
    expect(config.error).toMatch(/nested quantifier/);
  });

  it("rejects an invalid regular expression", () => {
    const config = parsePhiConfig({
      version: 1,
      additionalPatterns: [
        { id: "broken", tier: "warn", category: "other", pattern: "([a-z", message: "x" },
      ],
    });
    expect(config.error).toMatch(/not a valid regular expression/);
  });

  it("keeps the floor in force when the config file is unusable", () => {
    const config = parsePhiConfig({ version: 99 });
    expect(config.error).not.toBeNull();
    expect(rules(scan("call 555-867-5309", {}, config))).toEqual(["block:phone"]);
  });
});
