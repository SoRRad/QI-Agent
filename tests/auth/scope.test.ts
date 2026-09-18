import { describe, expect, it } from "vitest";
import {
  canRead,
  DEFAULT_TIER,
  redactForActor,
  SENSITIVITY_POLICY,
  tierFor,
  type ScopeActor,
} from "@/lib/auth/scope";

/**
 * The read-visibility boundary is a governance decision (Q4), not an
 * implementation detail, so it is tested as a specification. If one of these
 * tests changes, the committee has changed its mind and docs/SECURITY.md must
 * change with it.
 */

const MEDICINE = "program-medicine";
const SURGERY = "program-surgery";

const chair: ScopeActor = { id: "u-chair", role: "chair", programId: MEDICINE };
const medCoach: ScopeActor = { id: "u-coach-med", role: "coach", programId: MEDICINE };
const surgCoach: ScopeActor = { id: "u-coach-surg", role: "coach", programId: SURGERY };
const medTrainee: ScopeActor = { id: "u-tr-med", role: "trainee", programId: MEDICINE };
const surgTrainee: ScopeActor = { id: "u-tr-surg", role: "trainee", programId: SURGERY };

/** A Medicine project coached by the Medicine coach. */
const medProject = { programId: MEDICINE, coachId: medCoach.id };

describe("tierFor", () => {
  it("prefers an exact field entry over the model wildcard", () => {
    // PulseResponse.* is chair_only, and respondentName is named explicitly.
    expect(tierFor("PulseResponse", "respondentName")).toBe("chair_only");
    // Project.* has no wildcard, so an unnamed field falls back to the default.
    expect(tierFor("Project", "title")).toBe("cross_program");
    expect(tierFor("Project", "obstacleNotes")).toBe("owning_program");
  });

  it("falls back to the most restrictive tier for anything unnamed", () => {
    expect(DEFAULT_TIER).toBe("chair_only");
    expect(tierFor("SomeFutureModel", "someField")).toBe("chair_only");
    // A model added later without a policy entry must not leak by default.
    expect(canRead(medTrainee, "SomeFutureModel", "someField", medProject)).toBe(false);
  });
});

describe("the cross-cohort learning layer", () => {
  it("lets a trainee in another program read the registry layer", () => {
    // This is the whole point: a Surgery resident must be able to see that
    // Internal Medicine tried this in 2024 and why it ended.
    for (const field of ["title", "problemStatement", "status", "clerDomain", "completedAt"]) {
      expect(canRead(surgTrainee, "Project", field, medProject)).toBe(true);
    }
    expect(canRead(surgTrainee, "AimStatement", "text", medProject)).toBe(true);
    expect(canRead(surgTrainee, "MeasureDefinition", "numerator", medProject)).toBe(true);
    expect(canRead(surgTrainee, "SustainabilityPlan", "changeOwner", medProject)).toBe(true);
  });

  it("makes archived project records readable across programs", () => {
    expect(canRead(surgTrainee, "Project", "archivedAt", medProject)).toBe(true);
  });
});

describe("material restricted to the owning program", () => {
  it("hides data points and PDSA contents from another program", () => {
    expect(canRead(surgTrainee, "DataPoint", "value", medProject)).toBe(false);
    expect(canRead(surgTrainee, "PdsaCycle", "studyResult", medProject)).toBe(false);
    expect(canRead(surgTrainee, "Handoff", "summary", medProject)).toBe(false);
  });

  it("hides trainee free text about obstacles from another program", () => {
    expect(canRead(surgTrainee, "Project", "obstacleNotes", medProject)).toBe(false);
    expect(canRead(medTrainee, "Project", "obstacleNotes", medProject)).toBe(true);
  });

  it("grants the assigned coach access even from outside the program", () => {
    // A coach assigned to a project reads its restricted material wherever
    // they sit; a coach in another program with no assignment does not.
    const crossProgramAssignment = { programId: MEDICINE, coachId: surgCoach.id };
    expect(canRead(surgCoach, "PdsaCycle", "studyResult", crossProgramAssignment)).toBe(true);
    expect(canRead(surgCoach, "PdsaCycle", "studyResult", medProject)).toBe(false);
  });

  it("does not grant access on a null program or a null coach", () => {
    // A user with no program must not match a resource with no program.
    const orphanActor: ScopeActor = { id: "u-x", role: "trainee", programId: null };
    expect(canRead(orphanActor, "DataPoint", "value", { programId: null })).toBe(false);
    expect(canRead(medCoach, "DataPoint", "value", { programId: null, coachId: null })).toBe(false);
  });
});

describe("chair-only material", () => {
  it("hides named pulse responses and raw barrier text from coaches", () => {
    expect(canRead(medCoach, "PulseResponse", "respondentName", {})).toBe(false);
    expect(canRead(medCoach, "PulseResponse", "barrierText", {})).toBe(false);
    expect(canRead(chair, "PulseResponse", "respondentName", {})).toBe(true);
  });

  it("hides the audit log from everyone but the chair", () => {
    expect(canRead(medCoach, "AuditLog", "metadata", {})).toBe(false);
    expect(canRead(medTrainee, "AuditLog", "metadata", {})).toBe(false);
    expect(canRead(chair, "AuditLog", "metadata", {})).toBe(true);
  });

  it("still exposes the paraphrased barrier theme to everyone", () => {
    // The theme and what changed are the trainee-facing digest; only the raw
    // text behind them is restricted.
    expect(canRead(medTrainee, "Barrier", "themeLabel", {})).toBe(true);
    expect(canRead(medTrainee, "Barrier", "summary", {})).toBe(true);
    expect(canRead(medTrainee, "Barrier", "whatChanged", {})).toBe(true);
  });
});

describe("redactForActor", () => {
  it("strips restricted fields and keeps readable ones", () => {
    const row = {
      title: "Discharge summary completion within 48 hours",
      problemStatement: "Summaries are signed late.",
      obstacleNotes: "Weekend cross-cover is the hard part.",
      status: "active",
    };

    const asOwner = redactForActor(medTrainee, "Project", row, medProject);
    expect(asOwner.obstacleNotes).toBe(row.obstacleNotes);

    const asOutsider = redactForActor(surgTrainee, "Project", row, medProject);
    expect(asOutsider.title).toBe(row.title);
    expect(asOutsider.status).toBe("active");
    expect(asOutsider).not.toHaveProperty("obstacleNotes");
  });

  it("returns everything for the chair", () => {
    const row = { respondentName: "Dr. J. Oyelaran", barrierText: "No protected time." };
    expect(redactForActor(chair, "PulseResponse", row)).toEqual(row);
    expect(redactForActor(medCoach, "PulseResponse", row)).toEqual({});
  });
});

describe("policy integrity", () => {
  it("uses only the three defined tiers", () => {
    const allowed = new Set(["cross_program", "owning_program", "chair_only"]);
    for (const [key, tier] of Object.entries(SENSITIVITY_POLICY)) {
      expect(allowed.has(tier), `${key} has unknown tier ${tier}`).toBe(true);
    }
  });

  it("keys every entry as model.field", () => {
    for (const key of Object.keys(SENSITIVITY_POLICY)) {
      expect(key, `${key} is not model.field`).toMatch(/^[A-Z][A-Za-z]*\.([a-zA-Z]+|\*)$/);
    }
  });
});
