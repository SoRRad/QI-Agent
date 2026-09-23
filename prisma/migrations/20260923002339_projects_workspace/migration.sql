-- CreateEnum
CREATE TYPE "DriverKind" AS ENUM ('primary', 'secondary', 'change');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "endReason" TEXT,
ADD COLUMN     "outcomeSummary" TEXT,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "stallReason" TEXT;

-- CreateTable
CREATE TABLE "DriverNode" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" "DriverKind" NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverNode_projectId_idx" ON "DriverNode"("projectId");

-- CreateIndex
CREATE INDEX "DriverNode_parentId_idx" ON "DriverNode"("parentId");

-- CreateIndex
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverNode" ADD CONSTRAINT "DriverNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverNode" ADD CONSTRAINT "DriverNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DriverNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A driver diagram is a tree under the aim: primary drivers are its roots,
-- and nothing else may be. Parent-kind rules (secondary under primary, change
-- ideas under secondary) are enforced in lib/projects/drivers.ts.
ALTER TABLE "DriverNode" ADD CONSTRAINT "driver_node_root_is_primary"
  CHECK (("kind" = 'primary') = ("parentId" IS NULL));
