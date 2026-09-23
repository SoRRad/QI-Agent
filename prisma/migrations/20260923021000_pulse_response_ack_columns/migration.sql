-- A warn-tier PHI acknowledgement on a pulse response is recorded in the
-- audit log only, without the response's id (Q5, ADR-0012). A timestamp on
-- the response itself could be matched against that audit row, and so link an
-- anonymous response to the person who wrote it.
ALTER TABLE "PulseResponse" DROP COLUMN "phiAcknowledgedAt";
ALTER TABLE "PulseResponse" DROP COLUMN "phiAcknowledgedFlags";
