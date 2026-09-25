import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { TRAINEE_BASE_URL } from "./env";

/**
 * Phase 8: the Committee destination at 375px and 1280px, with axe on every
 * section. Exit criteria in the browser: the dashboard opens with an annotated
 * run chart, not stat cards; institution measures are run charts; milestone
 * output is marked as a draft requiring PD review; the judging results show
 * the seeded tie as a shared place.
 *
 * The default server's identity is the chair. Flows that change records run
 * once, at the primary viewport.
 */

async function noAxeViolations(page: Page, where: string) {
  await expect(page).toHaveTitle(/QI Agent/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(
    results.violations.map((v) => `${v.id} (${v.nodes.length})`),
    `axe on ${where}`,
  ).toEqual([]);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

const SECTIONS = ["Events", "Judging", "CLER mock", "Milestones", "Coaches", "Curriculum", "Annual report", "Library", "Dashboard"];

test("the dashboard opens with the headline run chart, and every committee section passes axe", async ({ page }) => {
  await page.goto("/committee");
  // The first thing on the page after the section tabs is the headline chart,
  // before any list or count.
  expect(await page.evaluate(() => document.querySelector("main [data-testid]")?.getAttribute("data-testid"))).toBe("headline-chart");
  const headline = page.getByTestId("headline-chart");
  await expect(headline.getByRole("img", { name: /all inpatient services: run chart/ })).toBeVisible();
  await expect(headline).toContainText("median frozen on the 13 months before the first intervention");
  await expect(
    headline.getByRole("list", {
      name: "Committee interventions on the chart",
    }),
  ).toContainText("Nov 2025 · Committee: huddle drafting adopted as an institutional standard");
  await expect(page.getByText("One quarter is not a trend")).toBeVisible();
  await noOverflow(page);
  await noAxeViolations(page, "committee dashboard");

  const nav = page.getByRole("navigation", { name: "Committee sections" });
  for (const section of SECTIONS) {
    await nav.getByRole("link", { name: section, exact: true }).click();
    await expect(nav.getByRole("link", { name: section, exact: true })).toHaveAttribute("aria-current", "page");
    await noOverflow(page);
    await noAxeViolations(page, `committee: ${section}`);
  }
});

test("judging shows the seeded tie as a shared first place, and exports it flagged", async ({ page }) => {
  await page.goto("/committee/judging");
  await page
    .getByRole("link", {
      name: /Autumn GME Quality Improvement Symposium: assign judges/,
    })
    .click();
  const results = page.getByTestId("judging-results");
  await expect(results.getByRole("listitem")).toHaveCount(3);
  await expect(results.getByRole("listitem").nth(0)).toContainText("=1");
  await expect(results.getByRole("listitem").nth(1)).toContainText("=1");
  await expect(results.getByRole("listitem").nth(2)).toContainText("Awaiting scores (1 of 2)");
  await expect(page.getByText("Shared places are shown as shared")).toBeVisible();
  // The chair coaches nothing here, but a coach of a project is never offered for it.
  await expect(page.getByText(/Not assignable: Dr\. S\. Lindqvist \(coaches this project\)/).first()).toBeVisible();
  await noOverflow(page);
  await noAxeViolations(page, "judging board");

  const response = await page.request.get((await page.getByRole("link", { name: "Export CSV" }).getAttribute("href"))!);
  expect(response.headers()["content-disposition"]).toContain('filename="autumn-gme-quality-improvement-symposium-results.csv"');
  const lines = (await response.text()).trim().split("\r\n");
  expect(lines[0]).toMatch(/^rank,tied,title,/);
  expect(lines.slice(1, 3).every((l) => l.startsWith("1,yes,"))).toBe(true);
});

test("a milestone draft is marked as requiring program director review", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-375", "Writes drafts: once, at the primary viewport.");
  await page.goto("/committee/milestones");
  await page.getByRole("link", { name: "Discharge summary completion within 48 hours" }).click();
  await page.getByLabel("Trainee").selectOption({ label: "Dr. J. Oyelaran" });
  await page.getByRole("button", { name: "Draft evidence" }).click();
  await expect(page.getByText(/Drafted \d+ entries/)).toBeVisible();
  const drafts = page.getByTestId("milestone-draft");
  await expect(drafts.first()).toBeVisible();
  const count = await drafts.count();
  for (let i = 0; i < count; i += 1) await expect(drafts.nth(i)).toContainText("DRAFT — requires program director review");
  await expect(drafts.first()).toContainText("Drawn from the record:");
  await noAxeViolations(page, "milestone drafts");

  await drafts.first().getByRole("button", { name: "Record program director review" }).click();
  await expect(drafts.first()).toContainText("PD review recorded");
});

test("the CLER mock reads gaps from the interviewer's ratings", async ({ page }, testInfo) => {
  await page.goto("/committee/cler");
  await page.getByRole("link", { name: "Mock CLER walkaround — medicine wards" }).click();
  const gaps = page.getByTestId("cler-gaps");
  await expect(gaps.getByRole("row", { name: /Supervision/ })).toContainText("Gap");
  await expect(gaps.getByRole("row", { name: /Professionalism/ })).toContainText("Not yet answered");
  await noOverflow(page);
  await noAxeViolations(page, "CLER mock");

  test.skip(testInfo.project.name !== "mobile-375", "Records an answer: once, at the primary viewport.");
  const wellBeing = page.getByRole("region", {
    name: /too exhausted to work safely/,
  });
  await wellBeing.getByLabel("Who answered").fill("PGY-3 resident");
  await wellBeing.getByLabel("Answer", { exact: true }).fill("I would tell the senior on call and take over their patients.");
  await wellBeing.getByLabel("Answered clearly").check();
  await wellBeing.getByRole("button", { name: "Save" }).click();
  await expect(gaps.getByRole("row", { name: /Well-being/ })).toContainText("Clear");
});

test("the chair generates an event kit from the record", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-375", "Writes the kit: once, at the primary viewport.");
  await page.goto("/committee/events");
  await page.getByRole("link", { name: "Autumn GME Quality Improvement Symposium" }).click();
  await page.getByRole("button", { name: /Generate/ }).click();
  const kit = page.getByTestId("event-kit");
  await expect(kit.getByRole("heading", { name: "Judging rubric" })).toBeVisible();
  await expect(kit).toContainText("[organiser to fill: room, start and finish times]");
  await noAxeViolations(page, "event kit");
});

test("a trainee is refused the committee", async ({ page }) => {
  await page.goto(`${TRAINEE_BASE_URL}/committee`);
  await expect(page.getByText("Committee is restricted to coaches and the chair")).toBeVisible();
  await page.goto(`${TRAINEE_BASE_URL}/committee/judging`);
  await expect(page.getByText("Committee is restricted to coaches and the chair")).toBeVisible();
  const csv = await page.request.get(`${TRAINEE_BASE_URL}/api/committee/curriculum`);
  expect(csv.status()).toBe(403);
});
