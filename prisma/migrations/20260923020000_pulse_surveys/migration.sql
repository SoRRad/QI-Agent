-- CreateEnum
CREATE TYPE "PulseSurveyStatus" AS ENUM ('draft', 'open', 'closed');

-- CreateEnum
CREATE TYPE "PulseQuestionKind" AS ENUM ('scale', 'single_choice', 'free_text', 'cler_domain');

-- CreateEnum
CREATE TYPE "PulseCoreField" AS ENUM ('confidence', 'cler_domain', 'barrier');

-- CreateTable
CREATE TABLE "PulseSurvey" (
    "id" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "status" "PulseSurveyStatus" NOT NULL DEFAULT 'draft',
    "intro" TEXT,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PulseSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PulseQuestion" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "PulseQuestionKind" NOT NULL,
    "core" "PulseCoreField",
    "prompt" TEXT NOT NULL,
    "help" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[],

    CONSTRAINT "PulseQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PulseParticipation" (
    "surveyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PulseParticipation_pkey" PRIMARY KEY ("surveyId","userId")
);

-- CreateTable
CREATE TABLE "PulseAnswer" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT,
    "number" INTEGER,

    CONSTRAINT "PulseAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PulseDigest" (
    "id" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "intro" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "barrierIds" TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "PulseDigest_pkey" PRIMARY KEY ("id")
);

-- AlterTable, with a backfill: every existing response is attached to a
-- survey for its quarter, and keeps the day it was submitted. The full
-- timestamp is then dropped (ADR-0012).
ALTER TABLE "PulseResponse"
ADD COLUMN     "receiptHash" TEXT,
ADD COLUMN     "respondentUserId" TEXT,
ADD COLUMN     "submittedOn" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "surveyId" TEXT;

INSERT INTO "PulseSurvey" ("id", "quarter", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, q."quarter", 'closed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "quarter" FROM "PulseResponse") q;

UPDATE "PulseResponse" r
SET "surveyId" = s."id", "submittedOn" = r."createdAt"::date
FROM "PulseSurvey" s
WHERE s."quarter" = r."quarter";

ALTER TABLE "PulseResponse" ALTER COLUMN "surveyId" SET NOT NULL;
ALTER TABLE "PulseResponse" DROP COLUMN "createdAt";

-- CreateIndex
CREATE UNIQUE INDEX "PulseSurvey_quarter_key" ON "PulseSurvey"("quarter");

-- CreateIndex
CREATE INDEX "PulseQuestion_surveyId_position_idx" ON "PulseQuestion"("surveyId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PulseQuestion_surveyId_core_key" ON "PulseQuestion"("surveyId", "core");

-- CreateIndex
CREATE INDEX "PulseParticipation_userId_idx" ON "PulseParticipation"("userId");

-- CreateIndex
CREATE INDEX "PulseAnswer_questionId_idx" ON "PulseAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "PulseAnswer_responseId_questionId_key" ON "PulseAnswer"("responseId", "questionId");

-- CreateIndex
CREATE INDEX "PulseDigest_publishedAt_idx" ON "PulseDigest"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PulseResponse_receiptHash_key" ON "PulseResponse"("receiptHash");

-- CreateIndex
CREATE INDEX "PulseResponse_surveyId_idx" ON "PulseResponse"("surveyId");

-- CreateIndex
CREATE INDEX "PulseResponse_respondentUserId_idx" ON "PulseResponse"("respondentUserId");

-- AddForeignKey
ALTER TABLE "PulseQuestion" ADD CONSTRAINT "PulseQuestion_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "PulseSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PulseParticipation" ADD CONSTRAINT "PulseParticipation_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "PulseSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PulseParticipation" ADD CONSTRAINT "PulseParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PulseResponse" ADD CONSTRAINT "PulseResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "PulseSurvey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PulseResponse" ADD CONSTRAINT "PulseResponse_respondentUserId_fkey" FOREIGN KEY ("respondentUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PulseAnswer" ADD CONSTRAINT "PulseAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "PulseResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PulseAnswer" ADD CONSTRAINT "PulseAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "PulseQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PulseDigest" ADD CONSTRAINT "PulseDigest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- A submitted response is a record of what a trainee said. Nothing edits it;
-- the only permitted change is a foreign key being cleared by ON DELETE SET
-- NULL. Theming links responses to barriers through the join table.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION qi_pulse_response_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."surveyId" IS DISTINCT FROM OLD."surveyId"
    OR NEW."quarter" IS DISTINCT FROM OLD."quarter"
    OR NEW."confidence" IS DISTINCT FROM OLD."confidence"
    OR NEW."clerDomain" IS DISTINCT FROM OLD."clerDomain"
    OR NEW."barrierText" IS DISTINCT FROM OLD."barrierText"
    OR NEW."respondentName" IS DISTINCT FROM OLD."respondentName"
    OR NEW."receiptHash" IS DISTINCT FROM OLD."receiptHash"
    OR NEW."submittedOn" IS DISTINCT FROM OLD."submittedOn"
    OR (NEW."respondentUserId" IS DISTINCT FROM OLD."respondentUserId" AND NEW."respondentUserId" IS NOT NULL)
    OR (NEW."programId" IS DISTINCT FROM OLD."programId" AND NEW."programId" IS NOT NULL)
  THEN
    RAISE EXCEPTION 'PulseResponse rows cannot be edited once submitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pulse_response_no_edit
  BEFORE UPDATE ON "PulseResponse"
  FOR EACH ROW EXECUTE FUNCTION qi_pulse_response_immutable();

ALTER TABLE "PulseResponse"
  ADD CONSTRAINT pulse_confidence_range CHECK ("confidence" BETWEEN 1 AND 5);

-- A core question is always the kind its field needs.
ALTER TABLE "PulseQuestion"
  ADD CONSTRAINT pulse_core_question_kind CHECK (
    "core" IS NULL
    OR ("core" = 'confidence' AND "kind" = 'scale')
    OR ("core" = 'cler_domain' AND "kind" = 'cler_domain')
    OR ("core" = 'barrier' AND "kind" = 'free_text')
  );

-- Only one survey is open at a time.
CREATE UNIQUE INDEX pulse_one_open_survey ON "PulseSurvey" ("status") WHERE "status" = 'open';
