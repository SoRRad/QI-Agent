-- Reproducibility evidence is written once.
--
-- MeasureDefinition already permits exactly one kind of post-insert change:
-- recording the plain-language restatement and the user's confirmation that it
-- matches their intent. This tightens that to what the evidence needs:
--
--   * a confirmation needs a restatement to confirm;
--   * once confirmed, neither the restatement nor the confirmation time may
--     change. A definition whose meaning changes is a new version, with its
--     own check.
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

  IF NEW."reproducibilityConfirmedAt" IS NOT NULL AND NEW."reproducibilityRestatement" IS NULL THEN
    RAISE EXCEPTION
      'MeasureDefinition version %: a reproducibility confirmation needs a restatement',
      OLD."version"
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."reproducibilityConfirmedAt" IS NOT NULL AND
     ROW(NEW."reproducibilityRestatement", NEW."reproducibilityConfirmedAt")
       IS DISTINCT FROM
     ROW(OLD."reproducibilityRestatement", OLD."reproducibilityConfirmedAt")
  THEN
    RAISE EXCEPTION
      'MeasureDefinition version % has a confirmed restatement; it cannot be changed',
      OLD."version"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
