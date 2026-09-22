-- DropIndex
DROP INDEX "project_problem_statement_trgm_idx";

-- DropIndex
DROP INDEX "project_title_trgm_idx";

-- AlterTable
ALTER TABLE "Measure" ADD COLUMN     "basedOnId" TEXT;

-- CreateIndex
CREATE INDEX "Measure_basedOnId_idx" ON "Measure"("basedOnId");

-- AddForeignKey
ALTER TABLE "Measure" ADD CONSTRAINT "Measure_basedOnId_fkey" FOREIGN KEY ("basedOnId") REFERENCES "Measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
