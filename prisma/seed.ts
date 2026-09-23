/**
 * Demo seed (§8).
 *
 * Contains a deliberately bad fourth project (addition C6). It exists so that
 * intake blocking, the aim critique rubric and devil's advocate are all
 * demonstrable in under thirty seconds — see docs/DEMO.md.
 *
 * Note on re-running: AuditLog is append-only at the database level and is
 * therefore never cleared here. Use `pnpm db:reset` for a genuinely clean
 * slate; it drops the schema rather than deleting rows.
 */

import "dotenv/config";
import { createDb } from "@/lib/db";
import { loadLibraryDocs } from "@/lib/content";
import { runWithContext } from "@/lib/request-context";
import { DISCHARGE_SERIES, LAB_SERIES, READMISSION_SERIES } from "./demo-data";

// The seed writes through the SAME guarded client as the application. It runs
// as trusted content, so warn-tier flags (the full dates in PDSA notes, for
// example) pass without an acknowledgement — but block-tier rules still apply,
// so a seed run that completes is proof the demo data contains no patient
// identifiers.
const db = createDb();

const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000);


async function clear(): Promise<void> {
  // FK-safe order. AuditLog is deliberately absent: it is append-only.
  await db.judgeScore.deleteMany();
  await db.submission.deleteMany();
  await db.event.deleteMany();
  await db.milestoneMap.deleteMany();
  await db.curriculumRecord.deleteMany();
  await db.knowledgeGap.deleteMany();
  await db.libraryDoc.deleteMany();
  await db.$executeRawUnsafe(`DELETE FROM "_BarrierPulseResponses"`).catch(() => undefined);
  await db.barrier.deleteMany();
  await db.pulseResponse.deleteMany();
  await db.sustainabilityPlan.deleteMany();
  await db.handoff.deleteMany();
  await db.pdsaCycle.deleteMany();
  await db.annotation.deleteMany();
  await db.dataPoint.deleteMany();
  await db.measureDefinition.deleteMany();
  await db.measure.updateMany({ data: { supersededById: null, basedOnId: null } });
  await db.measure.deleteMany();
  await db.aimStatement.deleteMany();
  await db.usageEvent.deleteMany();
  await db.project.deleteMany();
  // Users and programs are NOT deleted. The audit log may name them, and it
  // is append-only: deleting a user would rewrite who did what, which the
  // database refuses. They are upserted below by their natural keys instead,
  // which also keeps their ids stable across reseeds, so the audit trail
  // keeps pointing at the right people.
}

async function main(): Promise<void> {
  await clear();

  // ----------------------------------------------------------- library docs
  const docs = loadLibraryDocs();
  for (const doc of docs) {
    await db.libraryDoc.create({
      data: {
        slug: doc.slug,
        title: doc.title,
        body: doc.body,
        isLocal: doc.isLocal,
        localFieldsRequired: doc.localFieldsRequired,
      },
    });
  }
  const localCount = docs.filter((d) => d.isLocal).length;

  // --------------------------------------------------------------- programs
  const program = (data: { name: string; specialty: string; pdName: string; acgmeId: string }) =>
    db.program.upsert({ where: { acgmeId: data.acgmeId }, create: data, update: { ...data, active: true } });
  const medicine = await program({
    name: "Internal Medicine Residency",
    specialty: "Internal Medicine",
    pdName: "Dr. A. Okonkwo",
    acgmeId: "1401200001",
  });
  const surgery = await program({
    name: "General Surgery Residency",
    specialty: "General Surgery",
    pdName: "Dr. M. Baptiste",
    acgmeId: "4401200002",
  });

  // ------------------------------------------------------------------ users
  const user = (data: { email: string; name: string; role: "chair" | "coach" | "trainee"; programId: string }) =>
    db.user.upsert({ where: { email: data.email }, create: data, update: { ...data, active: true } });
  const chair = await user({ email: "chair@example.edu", name: "Dr. R. Adeyemi", role: "chair", programId: medicine.id });
  const coachMed = await user({ email: "coach.medicine@example.edu", name: "Dr. S. Lindqvist", role: "coach", programId: medicine.id });
  const coachSurg = await user({ email: "coach.surgery@example.edu", name: "Dr. T. Nakamura", role: "coach", programId: surgery.id });
  const traineeMed1 = await user({ email: "resident1.medicine@example.edu", name: "Dr. J. Oyelaran", role: "trainee", programId: medicine.id });
  const traineeMed2 = await user({ email: "resident2.medicine@example.edu", name: "Dr. P. Whitfield", role: "trainee", programId: medicine.id });
  const traineeSurg = await user({ email: "resident1.surgery@example.edu", name: "Dr. K. Aluko", role: "trainee", programId: surgery.id });

  // ------------------------------------------------- library (shared) measure
  // A superseded pair, so the deprecation banner (addition C3) is visible in
  // the demo rather than theoretical.
  const readmissionV1 = await db.measure.create({
    data: {
      name: "30-day all-cause readmission (2024 definition)",
      type: "outcome",
      chartType: "p",
      isLibrary: true,
      promotedAt: daysAgo(700),
      promotedById: chair.id,
      deprecated: true,
      deprecatedAt: daysAgo(120),
      deprecationNote:
        "Superseded: the 2024 definition counted observation stays in the numerator, which made it incomparable with the state all-payer report.",
      definitions: {
        create: {
          version: 1,
          numerator: "Index admissions followed by any inpatient readmission within 30 days of discharge, including observation stays.",
          denominator: "All adult inpatient discharges from the service in the measurement month.",
          inclusions: "Age 18+; discharged alive; medical and surgical services.",
          exclusions: "Planned readmissions; transfers to another acute facility; deaths during index stay.",
          dataSource: "EDW inpatient encounter table",
          puller: "Decision Support analyst on rotation",
          cadence: "monthly",
          createdById: chair.id,
        },
      },
    },
  });
  const readmissionV2 = await db.measure.create({
    data: {
      name: "30-day all-cause readmission",
      type: "outcome",
      chartType: "p",
      isLibrary: true,
      promotedAt: daysAgo(120),
      promotedById: chair.id,
      definitions: {
        create: {
          version: 1,
          numerator: "Index admissions followed by any unplanned inpatient readmission within 30 days of discharge. Observation stays are excluded from the numerator.",
          denominator: "All adult inpatient discharges from the service in the measurement month.",
          inclusions: "Age 18+; discharged alive; medical and surgical services.",
          exclusions: "Planned readmissions; transfers to another acute facility; deaths during index stay; observation stays.",
          dataSource: "EDW inpatient encounter table",
          puller: "Decision Support analyst on rotation",
          cadence: "monthly",
          createdById: chair.id,
          reproducibilityRestatement:
            "Count discharges in the month. Of those, count how many had another unplanned inpatient admission starting within 30 days of the discharge date. Divide the second count by the first.",
          reproducibilityConfirmedAt: daysAgo(119),
        },
      },
    },
  });
  await db.measure.update({
    where: { id: readmissionV1.id },
    data: { supersededById: readmissionV2.id },
  });

  // ============================================================= PROJECT 1
  // Active, 24 data points, a genuine shift. The demo centrepiece.
  const discharge = await db.project.create({
    data: {
      title: "Discharge summary completion within 48 hours",
      problemStatement:
        "Discharge summaries on the Hospitalist service are frequently signed days after the patient leaves, so the receiving primary care clinician has no document at the first post-discharge visit. Chart review of the last quarter found roughly a third of summaries signed beyond 48 hours, concentrated in weekend discharges.",
      status: "active",
      programId: medicine.id,
      ownerId: traineeMed1.id,
      clinicalOwner: "Dr. H. Vasquez, Hospitalist Medical Director",
      coachId: coachMed.id,
      sponsor: "Dr. A. Okonkwo, Program Director",
      analystContact: "Decision Support — R. Iyer",
      cohortYear: 2025,
      clerDomain: "care_transitions",
      equityStratificationPlan:
        "Stratify the outcome measure by preferred language and by insurance type. The team's hypothesis is that patients needing an interpreter for the post-discharge call are disproportionately affected by a missing summary.",
      obstacleNotes:
        "Weekend cross-cover is the hard part. The residents covering Saturday discharges are not the ones who admitted the patient and often do not know the hospital course well enough to write the summary quickly.",
      approvedAt: daysAgo(400),
      lastActivityAt: daysAgo(3),
    },
  });

  // Two aim versions, to exercise append-only versioning.
  await db.aimStatement.create({
    data: {
      projectId: discharge.id,
      version: 1,
      text: "Improve discharge summary timeliness on the Hospitalist service this year.",
      authorId: traineeMed1.id,
      createdAt: daysAgo(410),
    },
  });
  await db.aimStatement.create({
    data: {
      projectId: discharge.id,
      version: 2,
      text: "Reduce the proportion of discharge summaries signed more than 48 hours after discharge on the Hospitalist service at University Hospital from 34% (baseline, 1 October 2024 – 30 September 2025) to 15% by 30 June 2027.",
      baselineValue: 34.2,
      baselineUnit: "%",
      baselinePeriod: "1 October 2024 – 30 September 2025",
      target: 15,
      targetUnit: "%",
      deadline: new Date("2027-06-30T00:00:00Z"),
      population: "Adult patients discharged from the Hospitalist service at University Hospital",
      authorId: traineeMed1.id,
      createdAt: daysAgo(395),
    },
  });

  const dischargeOutcome = await db.measure.create({
    data: {
      projectId: discharge.id,
      name: "Discharge summaries signed >48h after discharge",
      type: "outcome",
      chartType: "p",
      definitions: {
        create: {
          version: 1,
          numerator: "Discharge summaries with a signature timestamp more than 48 hours after the recorded discharge date and time.",
          denominator: "All discharge summaries for patients discharged from the Hospitalist service in the calendar month.",
          inclusions: "Adult inpatients discharged from the Hospitalist service.",
          exclusions: "Deaths; transfers to another acute facility; patients who left against advice.",
          dataSource: "EHR documentation report DSR-114",
          puller: "Decision Support — R. Iyer",
          cadence: "monthly",
          createdById: traineeMed1.id,
          reproducibilityRestatement:
            "For each calendar month, take every discharge summary belonging to a Hospitalist discharge. Count the ones whose signature time is more than 48 hours after the discharge time. Divide by the total number of summaries for that month.",
          reproducibilityConfirmedAt: daysAgo(392),
        },
      },
    },
  });

  await db.measure.create({
    data: {
      projectId: discharge.id,
      name: "Summaries drafted before the patient physically leaves",
      type: "process",
      chartType: "p",
      definitions: {
        create: {
          version: 1,
          numerator: "Discharge summaries with a saved draft timestamp at or before the recorded discharge time.",
          denominator: "All discharge summaries for Hospitalist discharges in the calendar month.",
          inclusions: "Adult inpatients discharged from the Hospitalist service.",
          exclusions: "Deaths; transfers to another acute facility.",
          dataSource: "EHR documentation report DSR-114",
          puller: "Decision Support — R. Iyer",
          cadence: "monthly",
          createdById: traineeMed1.id,
        },
      },
    },
  });

  await db.measure.create({
    data: {
      projectId: discharge.id,
      name: "Median resident documentation time per discharge",
      type: "balancing",
      chartType: "xmr",
      definitions: {
        create: {
          version: 1,
          numerator: "Not applicable — this is a measurement, not a proportion. Median minutes of active documentation time per discharge encounter.",
          denominator: "Not applicable.",
          inclusions: "Hospitalist discharges documented by a resident.",
          exclusions: "Encounters with no recorded documentation time.",
          dataSource: "EHR audit log time-in-notes extract",
          puller: "Decision Support — R. Iyer",
          cadence: "monthly",
          createdById: traineeMed1.id,
        },
      },
    },
  });

  for (const [index, point] of DISCHARGE_SERIES.entries()) {
    await db.dataPoint.create({
      data: {
        measureId: dischargeOutcome.id,
        periodIndex: index + 1,
        periodLabel: point.label,
        numerator: point.num,
        denominator: point.den,
        // Computed here in TypeScript, never by a model (constraint 1).
        value: (point.num / point.den) * 100,
        subgroupSize: point.den,
        enteredById: traineeMed1.id,
      },
    });
  }

  // Built on the SUPERSEDED 2024 readmission definition, so its chart carries
  // the deprecation banner.
  const readmission = await db.measure.create({
    data: {
      projectId: discharge.id,
      name: "30-day readmission, Hospitalist service",
      type: "outcome",
      chartType: "p",
      basedOnId: readmissionV1.id,
      definitions: {
        create: {
          version: 1,
          numerator: "Index admissions followed by any inpatient readmission within 30 days of discharge, including observation stays.",
          denominator: "All adult discharges from the Hospitalist service in the measurement month.",
          inclusions: "Age 18+; discharged alive; Hospitalist service.",
          exclusions: "Planned readmissions; transfers to another acute facility; deaths during index stay.",
          dataSource: "EDW inpatient encounter table",
          puller: "Decision Support — R. Iyer",
          cadence: "monthly",
          createdById: traineeMed1.id,
        },
      },
    },
  });
  for (const [index, point] of READMISSION_SERIES.entries()) {
    await db.dataPoint.create({
      data: {
        measureId: readmission.id,
        periodIndex: index + 1,
        periodLabel: point.label,
        numerator: point.readmitted,
        denominator: point.discharges,
        value: (point.readmitted / point.discharges) * 100,
        subgroupSize: point.discharges,
        enteredById: traineeMed1.id,
      },
    });
  }

  await db.annotation.create({
    data: {
      measureId: dischargeOutcome.id,
      date: new Date("2025-10-01T00:00:00Z"),
      periodIndex: 13,
      label: "Discharge summary in the afternoon huddle",
      description:
        "Summary drafting moved into the existing 14:00 discharge huddle, with the admitting resident drafting before handing over to cross-cover.",
    },
  });
  await db.annotation.create({
    data: {
      measureId: dischargeOutcome.id,
      date: new Date("2026-02-01T00:00:00Z"),
      periodIndex: 17,
      label: "Weekend cross-cover template",
      description: "Structured template with the hospital course pre-populated from the daily progress notes.",
    },
  });

  // Driver diagram: aim → primary drivers → secondary drivers → change ideas.
  const driver = (kind: "primary" | "secondary" | "change", text: string, position: number, parentId: string | null = null) =>
    db.driverNode.create({ data: { projectId: discharge.id, kind, text, position, parentId } });
  const d1 = await driver("primary", "The summary is drafted while the team still knows the patient", 0);
  const d1a = await driver("secondary", "Drafting happens before the patient physically leaves", 0, d1.id);
  await driver("change", "Draft the summary in the existing 14:00 discharge huddle", 0, d1a.id);
  await driver("change", "Pre-populate the hospital course from daily progress notes", 1, d1a.id);
  const d1b = await driver("secondary", "The admitting resident, not cross-cover, owns the draft", 1, d1.id);
  await driver("change", "Name the drafting resident on the team list each morning", 0, d1b.id);
  const d2 = await driver("primary", "Weekend discharges are covered by someone who can write the summary", 1);
  const d2a = await driver("secondary", "Cross-cover has the hospital course at hand", 0, d2.id);
  await driver("change", "Structured weekend cross-cover template", 0, d2a.id);
  const d3 = await driver("primary", "Unsigned summaries are visible before they are late", 2);
  const d3a = await driver("secondary", "A daily list of unsigned summaries reaches the team", 0, d3.id);
  await driver("change", "Add unsigned summaries to the morning huddle board", 0, d3a.id);

  await db.pdsaCycle.create({
    data: {
      projectId: discharge.id,
      number: 1,
      plan: "For two weeks on one Hospitalist team, the admitting resident drafts the discharge summary during the 14:00 huddle on the day discharge is anticipated.",
      prediction:
        "Drafting before departure will rise from roughly 15% to about 50% on the pilot team within two weeks. Signed-late rate will fall by less than that, because the weekend backlog is unaffected by a weekday huddle.",
      doAction:
        "Ran on Team B for two weeks. The huddle already existed, so nothing new was scheduled. Two residents were on nights and never attended.",
      studyResult:
        "Drafting before departure reached 46% on Team B, close to the predicted 50%. Signed-late fell from 34% to 29%, less than the drafting change would suggest. The residual was almost entirely Saturday and Sunday discharges, as predicted.",
      actDecision: "adapt",
      plannedStart: daysAgo(380),
      plannedEnd: daysAgo(366),
      completedAt: daysAgo(364),
    },
  });
  await db.pdsaCycle.create({
    data: {
      projectId: discharge.id,
      number: 2,
      plan: "Add a structured weekend cross-cover template that pre-populates the hospital course from the preceding week of progress notes.",
      prediction:
        "Weekend signed-late rate will fall from about 48% to under 25% within a month. Documentation time per discharge will rise by no more than two minutes; if it rises more, the template is too long.",
      doAction:
        "Template built with the informatics team and enabled for both Hospitalist teams on 1 February 2026.",
      studyResult:
        "Weekend signed-late fell to 21%, better than predicted. Documentation time rose by 1.4 minutes, within the balancing threshold we set.",
      actDecision: "adopt",
      plannedStart: daysAgo(230),
      plannedEnd: daysAgo(200),
      completedAt: daysAgo(196),
    },
  });
  await db.pdsaCycle.create({
    data: {
      projectId: discharge.id,
      number: 3,
      plan: "Extend the huddle drafting practice from Team B to all four Hospitalist teams.",
      // No prediction yet, and therefore not completable: the database
      // constraint refuses a completedAt while prediction is null.
      plannedStart: daysAgo(20),
    },
  });

  // Unaccepted handoff, 20 days old — over the 14-day threshold, so it shows
  // as its own stall signal (addition C1).
  await db.handoff.create({
    data: {
      projectId: discharge.id,
      fromUserId: traineeMed1.id,
      toUserId: traineeMed2.id,
      summary:
        "Two cycles complete. The huddle change is adopted on Team B and the weekend template is live on both teams. The outcome measure shows a sustained shift from roughly 34% to roughly 17%.",
      openItems:
        "Cycle 3 (extending to all four teams) is planned but has no prediction written yet, so it cannot be closed. The equity stratification by preferred language has never been run.",
      dataAccessNotes:
        "Report DSR-114 is pulled monthly by R. Iyer in Decision Support; ask by email in the first week of the month. You need EHR reporting access, which takes about a week to provision.",
      nextActions: [
        "Write the prediction for cycle 3 before extending to the other three teams",
        "Request the stratified pull by preferred language for the full 24 months",
        "Draft the SQUIRE methods section while the cycle log is still fresh",
      ],
      coachContact: "Dr. S. Lindqvist (coach.medicine@example.edu)",
      createdAt: daysAgo(20),
    },
  });

  // ============================================================= PROJECT 2
  // Complete, with a sustainability plan.
  const labs = await db.project.create({
    data: {
      title: "Reducing routine daily laboratory testing on the surgical ward",
      problemStatement:
        "Daily complete blood counts and metabolic panels were ordered as recurring standing orders on the general surgery ward regardless of clinical trajectory, producing avoidable phlebotomy, hospital-acquired anaemia risk and cost, and waking stable patients before 05:00.",
      status: "complete",
      programId: surgery.id,
      ownerId: traineeSurg.id,
      outcomeSummary:
        "Routine draws fell from 2.3 to 1.5 per patient-day and stayed there for two quarters after the order set change. No harm from delayed electrolyte detection on chart review.",
      endReason: "Completed. The order set change is permanent and the measure continues quarterly under the ward director.",
      clinicalOwner: "Dr. L. Marchetti, Surgical Ward Director",
      coachId: coachSurg.id,
      sponsor: "Dr. M. Baptiste, Program Director",
      analystContact: "Decision Support — R. Iyer",
      cohortYear: 2024,
      clerDomain: "health_care_quality",
      equityStratificationPlan:
        "Stratified by insurance type to check that reduced testing was not concentrated in any one payer group.",
      approvedAt: daysAgo(800),
      completedAt: daysAgo(90),
      lastActivityAt: daysAgo(90),
    },
  });
  await db.aimStatement.create({
    data: {
      projectId: labs.id,
      version: 1,
      text: "Reduce routine laboratory draws per patient-day on the general surgery ward at University Hospital from 2.3 (baseline, January–June 2024) to 1.4 by 31 December 2025.",
      baselineValue: 2.3,
      baselineUnit: "draws per patient-day",
      baselinePeriod: "1 January – 30 June 2024",
      target: 1.4,
      targetUnit: "draws per patient-day",
      deadline: new Date("2025-12-31T00:00:00Z"),
      population: "Adult patients admitted to the general surgery ward at University Hospital",
      authorId: traineeSurg.id,
      createdAt: daysAgo(795),
    },
  });
  const labsMeasure = await db.measure.create({
    data: {
      projectId: labs.id,
      name: "Routine laboratory draws per patient-day",
      type: "outcome",
      chartType: "u",
      definitions: {
        create: {
          version: 1,
          numerator: "Count of routine CBC and basic/comprehensive metabolic panel results on the ward in the calendar month.",
          denominator: "Patient-days on the general surgery ward in the same month.",
          inclusions: "Adult general surgery ward admissions.",
          exclusions: "ICU days; intraoperative and PACU draws; type-and-screen and coagulation studies ordered for a procedure.",
          dataSource: "Laboratory information system monthly extract LAB-207",
          puller: "Decision Support — R. Iyer",
          cadence: "monthly",
          createdById: traineeSurg.id,
          reproducibilityRestatement:
            "For each month, count routine CBC and metabolic panel results on the surgical ward, then divide by the number of patient-days on that ward in the same month.",
          reproducibilityConfirmedAt: daysAgo(790),
        },
      },
    },
  });
  for (const [index, row] of LAB_SERIES.entries()) {
    await db.dataPoint.create({
      data: {
        measureId: labsMeasure.id,
        periodIndex: index + 1,
        periodLabel: row.label,
        numerator: row.count,
        denominator: row.days,
        value: row.count / row.days,
        subgroupSize: row.days,
        enteredById: traineeSurg.id,
      },
    });
  }
  await db.measure.create({
    data: {
      projectId: labs.id,
      name: "Missed clinically significant electrolyte abnormality",
      type: "balancing",
      chartType: "c",
      definitions: {
        create: {
          version: 1,
          numerator: "Count of cases per month where a potassium below 3.0 or above 5.5 was identified more than 24 hours after it would have been detected under the previous daily-draw practice, on chart review.",
          denominator: "Not applicable — this is a count chart over a roughly constant patient-day exposure.",
          inclusions: "Adult general surgery ward admissions.",
          exclusions: "Values drawn in the operating room or PACU.",
          dataSource: "Monthly chart review by the ward safety lead",
          puller: "Ward safety lead",
          cadence: "monthly",
          createdById: traineeSurg.id,
        },
      },
    },
  });
  await db.annotation.create({
    data: {
      measureId: labsMeasure.id,
      date: new Date("2025-07-01T00:00:00Z"),
      periodIndex: 7,
      label: "Standing orders retired",
      description: "Recurring daily lab orders removed from the surgical admission order set; daily labs now require an explicit indication.",
    },
  });
  await db.pdsaCycle.create({
    data: {
      projectId: labs.id,
      number: 1,
      plan: "Remove recurring daily CBC and metabolic panel from the surgical admission order set for two weeks on one team.",
      prediction: "Draws per patient-day will fall from 2.3 to about 1.6. We expect one or two cases of delayed electrolyte detection and will review every one.",
      doAction: "Order set changed for Team 1 on 1 July 2025.",
      studyResult: "Draws fell to 1.55. Two delayed-detection cases reviewed; neither resulted in harm and both were in patients on diuretics, which became an explicit indication to keep daily labs.",
      actDecision: "adopt",
      plannedStart: daysAgo(440),
      plannedEnd: daysAgo(425),
      completedAt: daysAgo(423),
    },
  });
  await db.sustainabilityPlan.create({
    data: {
      projectId: labs.id,
      changeOwner: "Dr. L. Marchetti, Surgical Ward Director — owns the admission order set configuration",
      continuingMeasureId: labsMeasure.id,
      cadence: "quarterly",
      reviewer: "Surgical Quality Committee, standing agenda item",
      notes:
        "The order set change is the durable part: daily labs now require an explicit indication, and reinstating a recurring order requires a change request. The measure continues quarterly rather than monthly. Diuretic use and active AKI are documented exceptions.",
    },
  });

  // ============================================================= PROJECT 3
  // Stalled: no activity in 60 days, past the 42-day threshold.
  const sepsis = await db.project.create({
    data: {
      title: "Time to first antibiotic dose in suspected sepsis",
      problemStatement:
        "Patients meeting sepsis criteria on the medical wards wait a median of 94 minutes for a first antibiotic dose, against an internal target of 60. The delay appears to sit between recognition and the order being placed rather than between order and administration.",
      status: "stalled",
      programId: medicine.id,
      ownerId: traineeMed2.id,
      stallReason: "No PDSA entry or data point in 60 days.",
      clinicalOwner: "Dr. C. Ibrahim, Sepsis Committee Chair",
      coachId: coachMed.id,
      sponsor: "Dr. A. Okonkwo, Program Director",
      cohortYear: 2026,
      clerDomain: "patient_safety",
      equityStratificationPlan: "Stratify by preferred language and by whether the patient arrived via the emergency department or was already admitted.",
      obstacleNotes:
        "We have been waiting eleven weeks for the sepsis time-stamp extract. The analyst who owns the report changed roles and nobody has picked it up. Without it there is no baseline and nothing to plot.",
      approvedAt: daysAgo(120),
      lastActivityAt: daysAgo(60),
      stalledAt: daysAgo(18),
    },
  });
  await db.aimStatement.create({
    data: {
      projectId: sepsis.id,
      version: 1,
      text: "Reduce median time from sepsis recognition to first antibiotic dose on the medical wards at University Hospital from 94 minutes (baseline, April–June 2026) to 60 minutes by 30 June 2027.",
      baselineValue: 94,
      baselineUnit: "minutes",
      baselinePeriod: "1 April – 30 June 2026",
      target: 60,
      targetUnit: "minutes",
      deadline: new Date("2027-06-30T00:00:00Z"),
      population: "Adult patients meeting sepsis screening criteria on the medical wards",
      authorId: traineeMed2.id,
      createdAt: daysAgo(118),
    },
  });
  await db.measure.create({
    data: {
      projectId: sepsis.id,
      name: "Median minutes from recognition to first antibiotic dose",
      type: "outcome",
      chartType: "xmr",
      definitions: {
        create: {
          version: 1,
          numerator: "Not applicable — median minutes between the sepsis screening alert timestamp and the first antibiotic administration timestamp.",
          denominator: "Not applicable.",
          inclusions: "Adult ward patients with a positive sepsis screen.",
          exclusions: "Patients already receiving antibiotics at the time of the screen; comfort-care-only patients.",
          dataSource: "Sepsis time-stamp extract (requested; not yet delivered)",
          puller: "Decision Support — owner currently unassigned",
          cadence: "monthly",
          createdById: traineeMed2.id,
        },
      },
    },
  });
  await db.measure.create({
    data: {
      projectId: sepsis.id,
      name: "Broad-spectrum antibiotic days of therapy per 1,000 patient-days",
      type: "balancing",
      chartType: "u",
      definitions: {
        create: {
          version: 1,
          numerator: "Days of therapy of antipseudomonal beta-lactams and vancomycin on the medical wards.",
          denominator: "Patient-days on the medical wards, per 1,000.",
          inclusions: "Adult medical ward patients.",
          exclusions: "ICU days.",
          dataSource: "Antimicrobial stewardship monthly report",
          puller: "Stewardship pharmacist",
          cadence: "monthly",
          createdById: traineeMed2.id,
        },
      },
    },
  });

  // ============================================================= PROJECT 5
  // Archived, from an earlier cohort. It exists so duplicate detection has a
  // real precedent to surface when someone proposes a handoff project again:
  // cross-cohort learning is the point (§6.2).
  const priorHandoff = await db.project.create({
    data: {
      title: "Standardised evening handoff using I-PASS on the medicine wards",
      problemStatement:
        "Evening handoffs between day and night residents on the medicine wards were unstructured, and the night team regularly re-derived plans that the day team had already made. Near-miss reports cited handoff omissions.",
      status: "archived",
      programId: medicine.id,
      clinicalOwner: "Dr. H. Vasquez, Hospitalist Medical Director",
      coachId: coachMed.id,
      cohortYear: 2023,
      clerDomain: "care_transitions",
      approvedAt: daysAgo(1100),
      completedAt: daysAgo(900),
      archivedAt: daysAgo(880),
      lastActivityAt: daysAgo(900),
      outcomeSummary:
        "Template use rose from about a fifth of handoffs to about two thirds on two wards within three months, then drifted back once the lead resident graduated.",
      endReason:
        "Ended when the resident lead graduated without a handoff; nobody owned the audit, so adherence was never measured again. The template itself still exists in the EHR.",
    },
  });
  await db.aimStatement.create({
    data: {
      projectId: priorHandoff.id,
      version: 1,
      text: "Increase the proportion of evening handoffs on the medicine wards at University Hospital that use every I-PASS element from 20% (baseline, September 2023) to 80% by 31 March 2024.",
      baselineValue: 20,
      baselineUnit: "%",
      baselinePeriod: "September 2023",
      target: 80,
      targetUnit: "%",
      deadline: new Date("2024-03-31T00:00:00Z"),
      population: "Resident-to-resident evening handoffs on the medicine wards",
      createdAt: daysAgo(1100),
    },
  });

  // ============================================================= PROJECT 4
  // Deliberately bad (addition C6). Vague aim, no balancing measure, no
  // clinical owner. This is the thirty-second demo of intake blocking.
  const badProject = await db.project.create({
    data: {
      title: "Improve handoff communication",
      problemStatement: "Handoffs are inconsistent and we think patient safety could be better.",
      status: "draft",
      programId: medicine.id,
      ownerId: traineeMed2.id,
      // No clinicalOwner: intake must block submission and say why.
      coachId: null,
      cohortYear: 2026,
      lastActivityAt: daysAgo(2),
    },
  });
  await db.aimStatement.create({
    data: {
      projectId: badProject.id,
      version: 1,
      // Fails all five elements. The critique rubric names each one.
      text: "Improve resident handoff communication in the ICU to enhance patient safety this academic year.",
      authorId: traineeMed2.id,
    },
  });
  // One process measure only — no outcome, and critically no balancing
  // measure, which is what intake blocks on.
  await db.measure.create({
    data: {
      projectId: badProject.id,
      name: "Handoffs using the standard template",
      type: "process",
      chartType: "p",
      definitions: {
        create: {
          version: 1,
          numerator: "Handoffs documented with the standard template.",
          denominator: "All handoffs.",
          inclusions: "ICU handoffs.",
          exclusions: "None specified.",
          dataSource: "Not yet identified",
          puller: "Not yet identified",
          cadence: "weekly",
          createdById: traineeMed2.id,
        },
      },
    },
  });

  // ------------------------------------------------------------------ pulse
  const quarter = "2026-Q3";
  const pulse: ReadonlyArray<{
    confidence: number;
    domain: "patient_safety" | "care_transitions" | "supervision";
    barrier: string;
    name?: string;
    programId?: string;
  }> = [
    { confidence: 2, domain: "care_transitions", barrier: "I could not get the data I needed. I asked for a report in March and still do not have it in September.", name: "Dr. J. Oyelaran", programId: medicine.id },
    { confidence: 1, domain: "care_transitions", barrier: "Nobody told me who the analyst was. I emailed three people and gave up.", programId: medicine.id },
    { confidence: 2, domain: "care_transitions", barrier: "The data request took so long that the resident who started the project had rotated off before it arrived.", programId: surgery.id },
    { confidence: 3, domain: "patient_safety", barrier: "My project needed an order set change and I never found out who approves those.", programId: medicine.id },
    { confidence: 2, domain: "patient_safety", barrier: "We were told to do a QI project but not given protected time, so it happened on days off or not at all.", name: "Dr. K. Aluko", programId: surgery.id },
    { confidence: 1, domain: "patient_safety", barrier: "No protected time. Realistically this competes with sleep after nights.", programId: surgery.id },
    { confidence: 4, domain: "supervision", barrier: "My coach was excellent but I only met them twice because of scheduling.", programId: medicine.id },
    { confidence: 3, domain: "supervision", barrier: "I was assigned a coach outside my specialty who did not know the clinical context, so most meetings were spent explaining it.", programId: surgery.id },
    { confidence: 2, domain: "supervision", barrier: "I did not know I was allowed to ask for a different coach.", programId: medicine.id },
    { confidence: 4, domain: "care_transitions", barrier: "The handoff project template from last year was genuinely useful. More of that.", name: "Dr. P. Whitfield", programId: medicine.id },
    { confidence: 5, domain: "patient_safety", barrier: "Having a statistician look at our run chart before the symposium changed how we presented it.", programId: medicine.id },
    { confidence: 3, domain: "supervision", barrier: "Feedback on the abstract came after the submission deadline had passed.", programId: surgery.id },
  ];
  const createdPulse = [];
  for (const row of pulse) {
    createdPulse.push(
      await db.pulseResponse.create({
        data: {
          quarter,
          confidence: row.confidence,
          clerDomain: row.domain,
          barrierText: row.barrier,
          respondentName: row.name ?? null,
          programId: row.programId ?? null,
        },
      }),
    );
  }

  // --------------------------------------------------------------- barriers
  // One closed barrier with `whatChanged`, so the "You reported, we changed"
  // landing view (addition C2) has something to show on first run.
  await db.barrier.create({
    data: {
      themeLabel: "Data access is the rate-limiting step",
      summary:
        "Trainees consistently report that obtaining the data extract is the slowest part of a project, often measured in months, and that ownership of a report is unclear when the original analyst moves roles.",
      count: 3,
      status: "closed",
      escalationTarget: "gmec",
      ownerId: chair.id,
      quarter,
      decision:
        "GMEC approved a named Decision Support liaison for GME quality improvement, with a standing two-week turnaround commitment for trainee data requests.",
      whatChanged:
        "There is now one named analyst liaison for trainee QI data requests, and requests are logged with a two-week turnaround commitment rather than routed ad hoc by email.",
      raisedAt: daysAgo(210),
      atGmecAt: daysAgo(150),
      decidedAt: daysAgo(100),
      closedAt: daysAgo(80),
      pulseResponses: { connect: createdPulse.slice(0, 3).map((p) => ({ id: p.id })) },
    },
  });
  await db.barrier.create({
    data: {
      themeLabel: "No protected time for improvement work",
      summary:
        "Respondents across both programs describe improvement work as competing directly with rest and clinical duties rather than being scheduled, with the result that projects advance irregularly or stop.",
      count: 2,
      status: "at_gmec",
      escalationTarget: "gmec",
      ownerId: chair.id,
      quarter,
      raisedAt: daysAgo(60),
      atGmecAt: daysAgo(20),
      pulseResponses: { connect: createdPulse.slice(4, 6).map((p) => ({ id: p.id })) },
    },
  });
  await db.barrier.create({
    data: {
      themeLabel: "Coach matching ignores clinical domain",
      summary:
        "Several respondents were paired with a coach outside their specialty and spent their limited contact time establishing clinical context rather than on method, and some did not know that reassignment was possible.",
      count: 3,
      status: "raised",
      escalationTarget: "committee",
      quarter,
      raisedAt: daysAgo(25),
      pulseResponses: { connect: createdPulse.slice(6, 9).map((p) => ({ id: p.id })) },
    },
  });

  // ----------------------------------------------------------------- events
  const symposium = await db.event.create({
    data: {
      quarter,
      type: "symposium",
      date: new Date("2026-11-12T13:00:00Z"),
      title: "Autumn GME Quality Improvement Symposium",
      agenda: "Poster session, four oral presentations, judging, and the committee's annual report to GMEC.",
    },
  });
  await db.submission.create({
    data: {
      eventId: symposium.id,
      projectId: discharge.id,
      abstract:
        "Background: Discharge summaries on the Hospitalist service were frequently signed more than 48 hours after discharge. Methods: Two PDSA cycles moved drafting into an existing discharge huddle and introduced a weekend cross-cover template, assessed with a p-chart over 24 months. Results: The signed-late proportion showed a sustained shift from a baseline of 34% to approximately 17%, with documentation time rising by 1.4 minutes per discharge. Conclusions: Relocating drafting into existing workflow, rather than adding a new step, accounted for most of the improvement.",
      presenters: "Dr. J. Oyelaran, Dr. P. Whitfield, Dr. S. Lindqvist",
    },
  });

  // ------------------------------------------------------------- curriculum
  const curriculum = ["QI Fundamentals module", "Run chart workshop", "PDSA workshop", "Operational definitions workshop"];
  for (const user of [traineeMed1, traineeMed2, traineeSurg]) {
    for (const [index, item] of curriculum.entries()) {
      await db.curriculumRecord.create({
        data: {
          userId: user.id,
          item,
          // Deliberately partial completion so the tracker has real gaps.
          completedAt: index < (user.id === traineeSurg.id ? 2 : 3) ? daysAgo(300 - index * 20) : null,
          source: "seed",
        },
      });
    }
  }

  // ---------------------------------------------------------- knowledge gaps
  // Questions the library genuinely cannot answer, because the three isLocal
  // documents are placeholders. This is the chair's queue on first run.
  await db.knowledgeGap.create({
    data: {
      question: "Do I need an IRB determination before I start collecting data, or only before I submit an abstract?",
      gapSummary:
        "Not covered. The IRB / QI determination policy document is an institutional placeholder; the timing requirement is a local decision that has not been supplied.",
      askedById: traineeMed1.id,
      askCount: 4,
      createdAt: daysAgo(30),
    },
  });
  await db.knowledgeGap.create({
    data: {
      question: "Who has to sign off on my project before the committee will review it?",
      gapSummary:
        "Not covered. The project intake requirements document is an institutional placeholder; required sign-offs have not been supplied.",
      askedById: traineeSurg.id,
      askCount: 2,
      createdAt: daysAgo(12),
    },
  });

  console.log(
    [
      "seeded:",
      `  library docs        ${docs.length} (${localCount} isLocal placeholders requiring institutional content)`,
      `  programs            2`,
      `  users               6 (1 chair, 2 coaches, 3 trainees)`,
      `  projects            5 (active, complete, stalled, archived, and one deliberately bad draft)`,
      `  library measures    2 (one superseded, to exercise the deprecation banner)`,
      `  data points         ${DISCHARGE_SERIES.length + LAB_SERIES.length + READMISSION_SERIES.length}`,
      `  pulse responses     ${pulse.length} across 3 CLER domains`,
      `  barriers            3 (raised, at_gmec, closed)`,
      `  knowledge gaps      2`,
      "",
      "  dev sign-in: DEV_USER_EMAIL=chair@example.edu (or use the role switcher)",
    ].join("\n"),
  );
}

runWithContext({ userId: null, acknowledgedPhi: new Set(), trustedContent: "seed" }, main)
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void db.$disconnect();
  });
