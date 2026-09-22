import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 4: the SPC studio, the chart-type advisor, the definition builder,
 * the data request and data entry — at 375px and 1280px, with axe on every
 * page. The exit criterion is here in so many words: the seeded 24-point
 * series visibly fires its shift, and charts render and annotate at 375px.
 */

async function noAxeViolations(page: Page, where: string) {
  // A server action's refresh re-streams the page metadata; let it settle so
  // axe sees the finished page rather than the moment between two titles.
  await expect(page).toHaveTitle(/QI Agent/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id} (${v.nodes.length})`), `axe on ${where}`).toEqual([]);
}

const DISCHARGE = "Discharge summaries signed >48h after discharge";

async function openMeasure(page: Page, name: string) {
  await page.goto("/charts");
  await page.getByRole("link", { name, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/**
 * Tests that write use a different measure per viewport, because the two
 * Playwright projects run in parallel against the same test database.
 */
/**
 * A unique, letters-only tag for text these tests write. Letters only: a long
 * run of digits is exactly what the PHI guard blocks.
 */
function tag(): string {
  return Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
}

function writableMeasure(): string {
  return test.info().project.name === "mobile-375"
    ? "Summaries drafted before the patient physically leaves"
    : "Median resident documentation time per discharge";
}

test("the studio shows the seeded series firing its shift", async ({ page }) => {
  await openMeasure(page, DISCHARGE);
  const chart = page.getByTestId("spc-chart");
  await expect(chart).toBeVisible();
  await expect(chart.locator("svg desc")).toContainText("Signals: Shift from Oct 2024 to Sep 2025; Shift from Oct 2025 to Sep 2026");

  const findings = page.getByTestId("findings");
  await expect(findings).toContainText("Shift from Oct 2024 to Sep 2025");
  await expect(findings).toContainText("Shift from Oct 2025 to Sep 2026");
  await expect(findings).toContainText("Too few runs");

  // Annotated: both changes are flagged on the chart and listed.
  await expect(page.getByText("Discharge summary in the afternoon huddle")).toBeVisible();
  await expect(page.getByText("Weekend cross-cover template")).toBeVisible();

  // No horizontal scrolling at either width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await noAxeViolations(page, "the SPC studio");
});

test("the chart reads each period from the keyboard", async ({ page }) => {
  await openMeasure(page, DISCHARGE);
  const chart = page.getByTestId("spc-chart");
  await chart.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("chart-announcement")).toHaveText(
    "Oct 2024: 34.8% (39 of 112). Median 26.7%. Special cause: Shift. Point 1 of 24.",
  );
  await expect(page.getByTestId("chart-tooltip")).toContainText("34.8%");
  await page.keyboard.press("End");
  await expect(page.getByTestId("chart-announcement")).toContainText("Sep 2026: 16.2%");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("chart-tooltip")).toHaveCount(0);
});

test("freezing the baseline turns the step change into points beyond the limit", async ({ page }) => {
  await openMeasure(page, DISCHARGE);
  await page.getByRole("link", { name: "p chart (control)" }).click();
  await expect(page.getByTestId("no-findings")).toBeVisible();

  await page.getByRole("link", { name: /Before change 1/ }).click();
  await expect(page).toHaveURL(/view=control&baseline=12/);
  await expect(page.getByTestId("findings")).toContainText("Beyond a control limit at 11 periods");
  await expect(page.getByTestId("spc-chart").locator("svg")).toContainText("BASELINE");
  await expect(page.getByText(/Extra pattern tests, such as eight points in a row/)).toBeVisible();

  await page.getByRole("link", { name: "On", exact: true }).click();
  await expect(page).toHaveURL(/we=on/);
  await noAxeViolations(page, "a frozen-baseline p chart");
});

test("explains the chart and shows where every number came from", async ({ page }) => {
  await openMeasure(page, DISCHARGE);
  await page.getByRole("button", { name: "Explain this chart" }).click();
  const interpretation = page.getByTestId("interpretation");
  await expect(interpretation).toContainText("shows a shift: 12 consecutive points");
  await expect(interpretation).not.toContainText("{{");

  await page.getByText("Where these numbers come from").click();
  const provenance = page.getByTestId("provenance");
  await expect(provenance).toContainText("median(values)");
  await expect(provenance).toContainText("lib/spc/median.ts");
  await expect(provenance).toContainText("runsCriticalValues(24)");
  await page.getByText("Data table (24 periods)").click();
  await expect(page.getByRole("table")).toContainText("39 of 112");
  await noAxeViolations(page, "the studio with its inspector open");
});

test("a chart built on a superseded definition says so", async ({ page }) => {
  await openMeasure(page, "30-day readmission, Hospitalist service");
  await expect(page.getByText(/The library definition behind this chart was superseded on/)).toBeVisible();
  await expect(page.getByText(/start a new measure instead/)).toBeVisible();
});

test("the advisor chooses a chart from the answers, with its reasons", async ({ page }) => {
  await page.goto("/charts/advisor");
  await expect(page.getByRole("heading", { level: 1, name: "Which chart?" })).toBeVisible();
  await page.getByRole("link", { name: /Whether each case met a criterion/ }).click();
  await page.getByRole("link", { name: /Several or more/ }).click();
  await page.getByRole("link", { name: /No, it varies/ }).click();
  await page.getByRole("link", { name: /12 or more/ }).click();
  const recommendation = page.getByTestId("recommendation");
  await expect(recommendation.getByRole("heading", { level: 2 })).toHaveText("p chart");
  await expect(recommendation).toContainText("the limits will step");
  await noAxeViolations(page, "an advisor recommendation");

  await page.getByRole("link", { name: "Change your answer to: What are you recording each period?" }).click();
  await page.getByRole("link", { name: /A measured amount/ }).click();
  await page.getByRole("link", { name: /One value per period/ }).click();
  await page.getByRole("link", { name: /Fewer than 12/ }).click();
  await expect(page.getByTestId("recommendation")).toContainText("In this studio today: Run chart");
});

test("the definition builder refuses to save until complete, then checks reproducibility", async ({ page }) => {
  const name = writableMeasure();
  await openMeasure(page, name);
  await page.getByRole("link", { name: "New version" }).click();
  await expect(page.getByText("7 of 7 parts complete")).toBeVisible();
  await noAxeViolations(page, "the definition builder");

  const numerator = page.getByLabel(/^Numerator/);
  const original = await numerator.inputValue();
  await numerator.fill("");
  await expect(page.getByText("6 of 7 parts complete")).toBeVisible();
  await expect(page.getByText("Still needed: Numerator.")).toBeVisible();
  const save = page.getByRole("button", { name: /Save version/ });
  await expect(save).toBeDisabled();

  // The server refuses too, whatever the browser sends.
  await save.evaluate((button) => button.removeAttribute("disabled"));
  await save.click();
  await expect(page.getByText("Not saved: the definition is incomplete")).toBeVisible();

  await numerator.fill(`${original} Checked ${tag()}.`);
  await page.getByRole("button", { name: /Save version/ }).click();
  await expect(page.getByText(/Saved as version \d+/)).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Restate it as a data query" }).click();
  await expect(page.getByTestId("restatement")).toContainText("Count ");
  await page.getByRole("button", { name: "Yes, this is what I mean" }).click();
  await expect(page.getByTestId("reproducibility-confirmed")).toBeVisible();
  await noAxeViolations(page, "a confirmed reproducibility check");
});

test("writes a data request with dates computed by the system", async ({ page }) => {
  await openMeasure(page, DISCHARGE);
  await page.getByRole("link", { name: "Write a data request" }).click();
  await page.getByLabel("From (month)").fill("2025-01");
  await page.getByLabel("To (month)").fill("2025-12");
  await page.getByRole("button", { name: "Write the request" }).click();
  await expect(page.getByTestId("request-range")).toHaveText("1 January 2025 to 31 December 2025: 12 months.");
  await expect(page.getByTestId("data-request")).toContainText("Aggregate counts only");
  await noAxeViolations(page, "a data request");
});

test("adds points by hand and by CSV, marks a change, and removes a mistake", async ({ page }) => {
  const name = writableMeasure();
  const stamp = tag();
  const p = test.info().project.name === "mobile-375";
  await openMeasure(page, name);
  await page.getByRole("link", { name: "Add data" }).first().click();
  await noAxeViolations(page, "data entry");

  // By hand.
  await page.getByLabel("Period", { exact: true }).fill(`Run ${stamp} A`);
  if (p) {
    await page.getByLabel(/^Numerator/).fill("30");
    await page.getByLabel(/^Denominator/).fill("120");
    await expect(page.getByText(`Will plot Run ${stamp} A at 25.0%.`)).toBeVisible();
  } else {
    await page.getByLabel("Value", { exact: true }).fill("41.5");
  }
  await page.getByRole("button", { name: "Add point" }).click();
  await expect(page.getByText(`Added Run ${stamp} A`)).toBeVisible();

  // By CSV: only the mapped columns leave the browser.
  const csv = p
    ? `month,late,total,notes\nRun ${stamp} B,20,100,x\nRun ${stamp} C,18,90,y\n`
    : `week,median,notes\nRun ${stamp} B,39,x\nRun ${stamp} C,37.5,y\n`;
  await page.getByLabel("CSV file").setInputFiles({ name: "extract.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("Which column is which?")).toBeVisible();
  if (p) {
    // "late" is not a name the mapper recognises, so the user maps it.
    await page.getByRole("combobox", { name: /^Numerator/ }).selectOption({ label: "late" });
    await expect(page.getByRole("combobox", { name: /^Denominator/ })).toHaveValue("2");
  }
  await expect(page.getByText("2 rows ready to add.")).toBeVisible();
  await page.getByRole("button", { name: "Add 2 points" }).click();
  await expect(page.getByText(`Added 2 points, Run ${stamp} B to Run ${stamp} C`)).toBeVisible();

  // Annotate the first new period.
  await page.getByLabel("What changed").fill(`Checklist ${stamp}`);
  await page.getByLabel("First period affected").selectOption({ label: `Run ${stamp} B` });
  await page.getByRole("button", { name: "Mark the change" }).click();
  await expect(page.getByText(`Marked “Checklist ${stamp}” on the chart.`)).toBeVisible();

  // The chart shows the new points and the annotation.
  await page.getByRole("link", { name: `← ${name}` }).click();
  await expect(page.getByTestId("spc-chart")).toBeVisible();
  await expect(page.getByText(`Checklist ${stamp}`)).toBeVisible();

  // Correct a mistake: only the latest point can go.
  await page.goto(page.url() + "/data");
  await page.getByRole("button", { name: `Remove the latest point (Run ${stamp} C)` }).click();
  await page.getByRole("button", { name: `Remove Run ${stamp} C` }).click();
  await expect(page.getByText(`Removed Run ${stamp} C.`)).toBeVisible();
});
