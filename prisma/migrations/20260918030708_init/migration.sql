-- CreateEnum
CREATE TYPE "Role" AS ENUM ('trainee', 'coach', 'chair');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('draft', 'submitted', 'approved', 'active', 'stalled', 'complete', 'archived');

-- CreateEnum
CREATE TYPE "MeasureType" AS ENUM ('outcome', 'process', 'balancing');

-- CreateEnum
CREATE TYPE "ChartType" AS ENUM ('run', 'xmr', 'p', 'u', 'c');

-- CreateEnum
CREATE TYPE "Cadence" AS ENUM ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual');

-- CreateEnum
CREATE TYPE "ActDecision" AS ENUM ('adopt', 'adapt', 'abandon');

-- CreateEnum
CREATE TYPE "BarrierStatus" AS ENUM ('raised', 'at_gmec', 'decided', 'closed');

-- CreateEnum
CREATE TYPE "EscalationTarget" AS ENUM ('committee', 'gmec', 'program');

-- CreateEnum
CREATE TYPE "ClerDomain" AS ENUM ('patient_safety', 'health_care_quality', 'care_transitions', 'supervision', 'well_being', 'professionalism');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('symposium', 'committee_meeting', 'workshop', 'cler_mock');

-- CreateEnum
CREATE TYPE "KnowledgeGapStatus" AS ENUM ('open', 'doc_planned', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "UsageEventKind" AS ENUM ('session_start', 'ask_query', 'knowledge_gap', 'coach_submission', 'chart_created', 'project_submitted', 'pulse_response', 'handoff_generated', 'export_generated');

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "pdName" TEXT,
    "acgmeId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'trainee',
    "programId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "problemStatement" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'draft',
    "programId" TEXT NOT NULL,
    "clinicalOwner" TEXT,
    "coachId" TEXT,
    "sponsor" TEXT,
    "analystContact" TEXT,
    "cohortYear" INTEGER,
    "clerDomain" "ClerDomain",
    "equityStratificationPlan" TEXT,
    "obstacleNotes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AimStatement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "baselineValue" DOUBLE PRECISION,
    "baselineUnit" TEXT,
    "baselinePeriod" TEXT,
    "target" DOUBLE PRECISION,
    "targetUnit" TEXT,
    "deadline" TIMESTAMP(3),
    "population" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AimStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measure" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "type" "MeasureType" NOT NULL,
    "chartType" "ChartType" NOT NULL,
    "isLibrary" BOOLEAN NOT NULL DEFAULT false,
    "promotedAt" TIMESTAMP(3),
    "promotedById" TEXT,
    "deprecated" BOOLEAN NOT NULL DEFAULT false,
    "deprecatedAt" TIMESTAMP(3),
    "deprecationNote" TEXT,
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasureDefinition" (
    "id" TEXT NOT NULL,
    "measureId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "numerator" TEXT NOT NULL,
    "denominator" TEXT NOT NULL,
    "inclusions" TEXT NOT NULL,
    "exclusions" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL,
    "puller" TEXT NOT NULL,
    "cadence" "Cadence" NOT NULL,
    "reproducibilityRestatement" TEXT,
    "reproducibilityConfirmedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeasureDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataPoint" (
    "id" TEXT NOT NULL,
    "measureId" TEXT NOT NULL,
    "periodIndex" INTEGER NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "numerator" DOUBLE PRECISION,
    "denominator" DOUBLE PRECISION,
    "value" DOUBLE PRECISION NOT NULL,
    "subgroupSize" DOUBLE PRECISION,
    "notes" TEXT,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL,
    "measureId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "periodIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PdsaCycle" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "plan" TEXT NOT NULL,
    "prediction" TEXT,
    "doAction" TEXT,
    "studyResult" TEXT,
    "actDecision" "ActDecision",
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdsaCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Handoff" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "summary" TEXT NOT NULL,
    "openItems" TEXT NOT NULL,
    "dataAccessNotes" TEXT NOT NULL,
    "nextActions" TEXT[],
    "coachContact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,

    CONSTRAINT "Handoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SustainabilityPlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "changeOwner" TEXT NOT NULL,
    "continuingMeasureId" TEXT,
    "cadence" "Cadence" NOT NULL,
    "reviewer" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SustainabilityPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PulseResponse" (
    "id" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "clerDomain" "ClerDomain",
    "barrierText" TEXT,
    "respondentName" TEXT,
    "programId" TEXT,
    "phiAcknowledgedAt" TIMESTAMP(3),
    "phiAcknowledgedFlags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PulseResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Barrier" (
    "id" TEXT NOT NULL,
    "themeLabel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "status" "BarrierStatus" NOT NULL DEFAULT 'raised',
    "escalationTarget" "EscalationTarget" NOT NULL DEFAULT 'committee',
    "ownerId" TEXT,
    "decision" TEXT,
    "whatChanged" TEXT,
    "quarter" TEXT,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atGmecAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Barrier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "agenda" TEXT,
    "materials" TEXT,
    "afterActionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "abstract" TEXT NOT NULL,
    "presenters" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeScore" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "judgeId" TEXT NOT NULL,
    "rubricScores" JSONB NOT NULL,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JudgeScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurriculumRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneMap" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "milestoneCode" TEXT NOT NULL,
    "evidenceText" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdReviewedAt" TIMESTAMP(3),
    "pdReviewedById" TEXT,

    CONSTRAINT "MilestoneMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryDoc" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isLocal" BOOLEAN NOT NULL DEFAULT false,
    "localFieldsRequired" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGap" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "gapSummary" TEXT,
    "status" "KnowledgeGapStatus" NOT NULL DEFAULT 'open',
    "askCount" INTEGER NOT NULL DEFAULT 1,
    "askedById" TEXT,
    "resolvedByDocId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "kind" "UsageEventKind" NOT NULL,
    "userId" TEXT,
    "role" "Role",
    "programId" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_BarrierPulseResponses" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BarrierPulseResponses_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Program_acgmeId_key" ON "Program"("acgmeId");

-- CreateIndex
CREATE INDEX "Program_specialty_idx" ON "Program"("specialty");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_programId_role_idx" ON "User"("programId", "role");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Project_programId_status_idx" ON "Project"("programId", "status");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_clerDomain_idx" ON "Project"("clerDomain");

-- CreateIndex
CREATE INDEX "Project_cohortYear_idx" ON "Project"("cohortYear");

-- CreateIndex
CREATE INDEX "Project_coachId_idx" ON "Project"("coachId");

-- CreateIndex
CREATE INDEX "AimStatement_projectId_idx" ON "AimStatement"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AimStatement_projectId_version_key" ON "AimStatement"("projectId", "version");

-- CreateIndex
CREATE INDEX "Measure_projectId_idx" ON "Measure"("projectId");

-- CreateIndex
CREATE INDEX "Measure_isLibrary_deprecated_idx" ON "Measure"("isLibrary", "deprecated");

-- CreateIndex
CREATE INDEX "Measure_type_idx" ON "Measure"("type");

-- CreateIndex
CREATE INDEX "MeasureDefinition_measureId_idx" ON "MeasureDefinition"("measureId");

-- CreateIndex
CREATE UNIQUE INDEX "MeasureDefinition_measureId_version_key" ON "MeasureDefinition"("measureId", "version");

-- CreateIndex
CREATE INDEX "DataPoint_measureId_periodIndex_idx" ON "DataPoint"("measureId", "periodIndex");

-- CreateIndex
CREATE UNIQUE INDEX "DataPoint_measureId_periodIndex_key" ON "DataPoint"("measureId", "periodIndex");

-- CreateIndex
CREATE INDEX "Annotation_measureId_idx" ON "Annotation"("measureId");

-- CreateIndex
CREATE INDEX "PdsaCycle_projectId_idx" ON "PdsaCycle"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PdsaCycle_projectId_number_key" ON "PdsaCycle"("projectId", "number");

-- CreateIndex
CREATE INDEX "Handoff_projectId_idx" ON "Handoff"("projectId");

-- CreateIndex
CREATE INDEX "Handoff_acceptedAt_idx" ON "Handoff"("acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SustainabilityPlan_projectId_key" ON "SustainabilityPlan"("projectId");

-- CreateIndex
CREATE INDEX "PulseResponse_quarter_idx" ON "PulseResponse"("quarter");

-- CreateIndex
CREATE INDEX "PulseResponse_programId_quarter_idx" ON "PulseResponse"("programId", "quarter");

-- CreateIndex
CREATE INDEX "PulseResponse_clerDomain_idx" ON "PulseResponse"("clerDomain");

-- CreateIndex
CREATE INDEX "Barrier_status_idx" ON "Barrier"("status");

-- CreateIndex
CREATE INDEX "Barrier_quarter_idx" ON "Barrier"("quarter");

-- CreateIndex
CREATE INDEX "Event_quarter_idx" ON "Event"("quarter");

-- CreateIndex
CREATE INDEX "Submission_eventId_idx" ON "Submission"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_eventId_projectId_key" ON "Submission"("eventId", "projectId");

-- CreateIndex
CREATE INDEX "JudgeScore_submissionId_idx" ON "JudgeScore"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "JudgeScore_submissionId_judgeId_key" ON "JudgeScore"("submissionId", "judgeId");

-- CreateIndex
CREATE INDEX "CurriculumRecord_userId_idx" ON "CurriculumRecord"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumRecord_userId_item_key" ON "CurriculumRecord"("userId", "item");

-- CreateIndex
CREATE INDEX "MilestoneMap_projectId_idx" ON "MilestoneMap"("projectId");

-- CreateIndex
CREATE INDEX "MilestoneMap_userId_idx" ON "MilestoneMap"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryDoc_slug_key" ON "LibraryDoc"("slug");

-- CreateIndex
CREATE INDEX "LibraryDoc_isLocal_idx" ON "LibraryDoc"("isLocal");

-- CreateIndex
CREATE INDEX "KnowledgeGap_status_idx" ON "KnowledgeGap"("status");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "UsageEvent_kind_createdAt_idx" ON "UsageEvent"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_programId_kind_idx" ON "UsageEvent"("programId", "kind");

-- CreateIndex
CREATE INDEX "UsageEvent_role_kind_idx" ON "UsageEvent"("role", "kind");

-- CreateIndex
CREATE INDEX "_BarrierPulseResponses_B_index" ON "_BarrierPulseResponses"("B");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AimStatement" ADD CONSTRAINT "AimStatement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AimStatement" ADD CONSTRAINT "AimStatement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measure" ADD CONSTRAINT "Measure_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measure" ADD CONSTRAINT "Measure_promotedById_fkey" FOREIGN KEY ("promotedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measure" ADD CONSTRAINT "Measure_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "Measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasureDefinition" ADD CONSTRAINT "MeasureDefinition_measureId_fkey" FOREIGN KEY ("measureId") REFERENCES "Measure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasureDefinition" ADD CONSTRAINT "MeasureDefinition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataPoint" ADD CONSTRAINT "DataPoint_measureId_fkey" FOREIGN KEY ("measureId") REFERENCES "Measure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataPoint" ADD CONSTRAINT "DataPoint_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_measureId_fkey" FOREIGN KEY ("measureId") REFERENCES "Measure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdsaCycle" ADD CONSTRAINT "PdsaCycle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SustainabilityPlan" ADD CONSTRAINT "SustainabilityPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SustainabilityPlan" ADD CONSTRAINT "SustainabilityPlan_continuingMeasureId_fkey" FOREIGN KEY ("continuingMeasureId") REFERENCES "Measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PulseResponse" ADD CONSTRAINT "PulseResponse_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barrier" ADD CONSTRAINT "Barrier_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeScore" ADD CONSTRAINT "JudgeScore_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeScore" ADD CONSTRAINT "JudgeScore_judgeId_fkey" FOREIGN KEY ("judgeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumRecord" ADD CONSTRAINT "CurriculumRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneMap" ADD CONSTRAINT "MilestoneMap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneMap" ADD CONSTRAINT "MilestoneMap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneMap" ADD CONSTRAINT "MilestoneMap_pdReviewedById_fkey" FOREIGN KEY ("pdReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryDoc" ADD CONSTRAINT "LibraryDoc_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_askedById_fkey" FOREIGN KEY ("askedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_resolvedByDocId_fkey" FOREIGN KEY ("resolvedByDocId") REFERENCES "LibraryDoc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BarrierPulseResponses" ADD CONSTRAINT "_BarrierPulseResponses_A_fkey" FOREIGN KEY ("A") REFERENCES "Barrier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BarrierPulseResponses" ADD CONSTRAINT "_BarrierPulseResponses_B_fkey" FOREIGN KEY ("B") REFERENCES "PulseResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
