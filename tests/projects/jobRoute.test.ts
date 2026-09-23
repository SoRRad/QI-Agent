import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/jobs/stall/route";

/** The nightly job route authenticates its caller and does nothing else. */

const hasDb = !!process.env["DATABASE_URL_TEST"];
const saved = process.env["JOB_SECRET"];
afterEach(() => {
  process.env["JOB_SECRET"] = saved;
});

const call = (headers: Record<string, string>) => POST(new Request("http://localhost/api/jobs/stall", { method: "POST", headers }));

describe("POST /api/jobs/stall", () => {
  it("refuses to run without a configured secret", async () => {
    delete process.env["JOB_SECRET"];
    expect((await call({ "x-job-secret": "" })).status).toBe(401);
  });

  it("refuses a wrong or missing credential", async () => {
    process.env["JOB_SECRET"] = "s3cret-value-for-tests";
    expect((await call({})).status).toBe(401);
    expect((await call({ "x-job-secret": "s3cret-value-for-test" })).status).toBe(401);
    expect((await call({ authorization: "Bearer nope" })).status).toBe(401);
  });

  it.skipIf(!hasDb)("runs with the shared secret, from the scheduler or from Vercel Cron", async () => {
    process.env["JOB_SECRET"] = "s3cret-value-for-tests";
    const viaHeader = await call({ "x-job-secret": "s3cret-value-for-tests" });
    expect(viaHeader.status).toBe(200);
    expect(await viaHeader.json()).toMatchObject({ checked: expect.any(Number), stalled: expect.any(Array) });
    expect((await call({ authorization: "Bearer s3cret-value-for-tests" })).status).toBe(200);
  });
});
