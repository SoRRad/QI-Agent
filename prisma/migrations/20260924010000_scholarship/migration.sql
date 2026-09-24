-- CreateEnum
CREATE TYPE "IrbScreenOutcome" AS ENUM ('likely_qi', 'likely_research', 'ambiguous');

-- CreateTable
CREATE TABLE "AbstractDraft" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "title" TEXT,
    "sections" JSONB NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbstractDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IrbPrecheck" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "outcome" "IrbScreenOutcome" NOT NULL,
    "memo" TEXT NOT NULL,
    "policyDocId" TEXT,
    "policyDocVersion" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IrbPrecheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AbstractDraft_projectId_venueId_key" ON "AbstractDraft"("projectId", "venueId");

-- CreateIndex
CREATE INDEX "IrbPrecheck_projectId_createdAt_idx" ON "IrbPrecheck"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "AbstractDraft" ADD CONSTRAINT "AbstractDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbstractDraft" ADD CONSTRAINT "AbstractDraft_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IrbPrecheck" ADD CONSTRAINT "IrbPrecheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IrbPrecheck" ADD CONSTRAINT "IrbPrecheck_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A screening is a record of what was answered and when: never edited.
CREATE OR REPLACE FUNCTION qi_irb_precheck_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'IrbPrecheck rows are a record of a screening and cannot be edited; run a new screening instead'
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER irb_precheck_no_update
  BEFORE UPDATE ON "IrbPrecheck"
  FOR EACH ROW EXECUTE FUNCTION qi_irb_precheck_immutable();
