-- Database-level enforcement of the brief's non-negotiable rules.
--
-- These are deliberately NOT application-layer validations. Application code
-- gets refactored; a trigger does not quietly stop applying.

-- ---------------------------------------------------------------------------
-- 1. AuditLog is append-only.
--
-- The audit trail is the evidence that a PHI block occurred, that an
-- attestation was recorded, and who read what. If it can be rewritten it is
-- not evidence. INSERT is allowed; UPDATE and DELETE raise.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION qi_audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'AuditLog is append-only: % on audit_log is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION qi_audit_log_append_only();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION qi_audit_log_append_only();

-- ---------------------------------------------------------------------------
-- 2. A PDSA cycle cannot be completed without a prediction.
--
-- "The prediction field is required before the cycle can be marked done."
-- A PDSA cycle without a prediction is not a test of a theory, it is an
-- activity log, so this is a constraint rather than a form validation.
-- ---------------------------------------------------------------------------

ALTER TABLE "PdsaCycle"
  ADD CONSTRAINT pdsa_prediction_required_when_complete
  CHECK (
    "completedAt" IS NULL
    OR ("prediction" IS NOT NULL AND length(btrim("prediction")) > 0)
  );

-- ---------------------------------------------------------------------------
-- 3. Append-only versioned text.
--
-- AimStatement and MeasureDefinition rows are historical records: an older
-- aim explains what a chart meant at the time it was plotted. Editing one
-- silently rewrites the past, so only INSERT and DELETE (cascade cleanup)
-- are permitted. Corrections are made by inserting the next version.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION qi_versioned_text_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    '% rows are append-only; insert a new version instead of updating version %',
    TG_TABLE_NAME, OLD."version"
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER aim_statement_no_update
  BEFORE UPDATE ON "AimStatement"
  FOR EACH ROW EXECUTE FUNCTION qi_versioned_text_immutable();

-- MeasureDefinition permits exactly one post-insert mutation: recording that
-- the user confirmed the plain-language restatement matches their intent.
-- Nothing that changes the definition's meaning may be updated.
CREATE OR REPLACE FUNCTION qi_measure_definition_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(NEW."measureId", NEW."version", NEW."numerator", NEW."denominator",
         NEW."inclusions", NEW."exclusions", NEW."dataSource", NEW."puller",
         NEW."cadence", NEW."createdById", NEW."createdAt")
     IS DISTINCT FROM
     ROW(OLD."measureId", OLD."version", OLD."numerator", OLD."denominator",
         OLD."inclusions", OLD."exclusions", OLD."dataSource", OLD."puller",
         OLD."cadence", OLD."createdById", OLD."createdAt")
  THEN
    RAISE EXCEPTION
      'MeasureDefinition is append-only: insert a new version instead of changing version %',
      OLD."version"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER measure_definition_append_only
  BEFORE UPDATE ON "MeasureDefinition"
  FOR EACH ROW EXECUTE FUNCTION qi_measure_definition_guard();

-- ---------------------------------------------------------------------------
-- 4. Trigram index support for registry duplicate detection (ADR-0003).
--
-- Candidate recall for "has another program already tried this?" runs on
-- pg_trgm similarity, with an LLM re-rank over the top candidates. pgvector
-- remains the documented upgrade path behind lib/search/similar.ts.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX project_title_trgm_idx
  ON "Project" USING gin ("title" gin_trgm_ops);

CREATE INDEX project_problem_statement_trgm_idx
  ON "Project" USING gin ("problemStatement" gin_trgm_ops);
