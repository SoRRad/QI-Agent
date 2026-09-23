-- CreateIndex
CREATE INDEX "project_title_trgm_idx" ON "Project" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "project_problem_statement_trgm_idx" ON "Project" USING GIN ("problemStatement" gin_trgm_ops);
