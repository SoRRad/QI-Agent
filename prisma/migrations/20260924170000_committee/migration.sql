-- CreateEnum
CREATE TYPE "ClerRating" AS ENUM ('clear', 'partial', 'unable');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "kit" JSONB,
ADD COLUMN     "kitGeneratedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Measure" ADD COLUMN     "isHeadline" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "expertise" "ClerDomain"[];

-- CreateTable
CREATE TABLE "JudgeAssignment" (
    "submissionId" TEXT NOT NULL,
    "judgeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudgeAssignment_pkey" PRIMARY KEY ("submissionId","judgeId")
);

-- CreateTable
CREATE TABLE "ClerQuestion" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "domain" "ClerDomain" NOT NULL,
    "question" TEXT NOT NULL,
    "respondent" TEXT,
    "response" TEXT,
    "rating" "ClerRating",
    "notes" TEXT,
    "recordedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClerQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JudgeAssignment_judgeId_idx" ON "JudgeAssignment"("judgeId");

-- CreateIndex
CREATE INDEX "ClerQuestion_eventId_position_idx" ON "ClerQuestion"("eventId", "position");

-- AddForeignKey
ALTER TABLE "JudgeScore" ADD CONSTRAINT "JudgeScore_submissionId_judgeId_fkey" FOREIGN KEY ("submissionId", "judgeId") REFERENCES "JudgeAssignment"("submissionId", "judgeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT "JudgeAssignment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT "JudgeAssignment_judgeId_fkey" FOREIGN KEY ("judgeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClerQuestion" ADD CONSTRAINT "ClerQuestion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClerQuestion" ADD CONSTRAINT "ClerQuestion_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- The headline measure opens the chair dashboard. It is an institution-level
-- library measure, never a project's, and there is at most one.
-- ---------------------------------------------------------------------------
ALTER TABLE "Measure"
  ADD CONSTRAINT measure_headline_is_institutional CHECK (NOT "isHeadline" OR ("projectId" IS NULL AND "isLibrary"));

CREATE UNIQUE INDEX measure_one_headline ON "Measure" ("isHeadline") WHERE "isHeadline";
