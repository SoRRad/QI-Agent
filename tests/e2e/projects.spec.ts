import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 5: registry, intake, workspace, PDSA, drivers, handoff and the stalled
 * queue — at 375px and 1280px, with axe on every page. Exit criteria in the
 * browser: submission blocked with a specific explanation; a PDSA cycle cannot
 * be marked done without a prediction; archived projects stay searchable.
 */

async function noAxeViolations(page: Page, where: string) {
  await expect(page).toHaveTitle(/QI Agent/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id} (${v.nodes.length})`), `axe on ${where}`).toEqual([]);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

const tag = () => Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const DISCHARGE = "Discharge summary completion within 48 hours";

async function openProject(page: Page, title: string) {
  await page.goto("/projects");
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

test("the registry filters, and archived projects stay searchable", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { level: 1, name: "Registry" })).toBeVisible();
  await noOverflow(page);
  await noAxeViolations(page, "the registry");

  await page.getByLabel("Search titles, problems, aims and outcomes").fill("I-PASS");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("link", { name: /Standardised evening handoff using I-PASS/ })).toBeVisible();
  await expect(page.getByText(/Why it ended/)).toBeVisible();

  await page.goto("/projects?status=stalled");
  await expect(page.getByRole("link", { name: "Time to first antibiotic dose in suspected sepsis" })).toBeVisible();
  await expect(page.getByRole("link", { name: DISCHARGE })).toHaveCount(0);
});

test("intake blocks the bad project with a specific explanation for each gap", async ({ page }) => {
  await openProject(page, "Improve handoff communication");
  await page.getByRole("link", { name: "Continue intake" }).click();
  const blockers = page.getByTestId("intake-blockers");
  await expect(blockers).toContainText("There is no balancing measure");
  await expect(blockers).toContainText("There is no clinical owner");
  await expect(blockers).toContainText("The aim is missing all five elements");
  await noAxeViolations(page, "the intake review");

  await page.getByRole("button", { name: "Submit for committee review" }).click();
  const refusal = page.getByText("Not submitted — the committee needs these first");
  await expect(refusal).toBeVisible();
  await expect(page.getByRole("alert").or(page.locator("[aria-live]")).filter({ hasText: /balancing measure checks that improving one thing/ }).first()).toBeVisible();
});

test("intake finds the archived precedent and checks the aim as you type", async ({ page }) => {
  const title = `Evening handoff checklist ${tag()}`;
  await page.goto("/projects/new");
  await noAxeViolations(page, "a new project");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("The problem").fill("Evening handoffs between day and night residents omit pending results, and night teams re-derive plans already made.");
  await page.getByRole("button", { name: "Save and check the registry" }).click();

  await expect(page).toHaveURL(/intake\?step=problem/);
  const similar = page.getByTestId("similar-projects");
  await expect(similar).toContainText("Standardised evening handoff using I-PASS");
  await expect(similar).toContainText("Why it ended");
  await noOverflow(page);
  await noAxeViolations(page, "intake with similar projects");

  await page.getByRole("link", { name: /Next: Aim/ }).click();
  const rubric = page.getByTestId("aim-rubric");
  await expect(rubric).toContainText("0 of 5 elements present");
  await page.getByLabel("Aim statement", { exact: true }).fill("Increase the proportion of evening handoffs using every checklist element from 20% to 80% by 31 March 2027.");
  await page.getByLabel("Deadline").fill("2027-03-31");
  await expect(rubric).not.toContainText("0 of 5");
  await noAxeViolations(page, "the aim step");
});

test("a PDSA cycle cannot be marked done without a prediction", async ({ page }) => {
  await openProject(page, DISCHARGE);
  await page.getByRole("navigation", { name: "Project workspace" }).getByRole("link", { name: "PDSA" }).click();
  await expect(page.getByText("Cycle 3 · open")).toBeVisible();
  await expect(page.getByTestId("cycle-3-predicted")).toHaveText("No prediction written.");
  await noAxeViolations(page, "the PDSA log");
  await page.getByRole("button", { name: "Mark cycle done" }).first().click();
  await expect(page.getByText(/Write the prediction before marking this cycle done/)).toBeVisible();
  await expect(page.getByText("Cycle 3 · open")).toBeVisible();
});

test("every workspace tab renders without overflow and passes axe", async ({ page }) => {
  await openProject(page, DISCHARGE);
  // The current aim's rubric; the new-version form below has its own live one.
  await expect(page.getByTestId("aim-rubric").first()).toContainText("All five elements present");
  await noAxeViolations(page, "the aim tab");
  const tabs = page.getByRole("navigation", { name: "Project workspace" });
  for (const tab of ["Drivers", "Measures", "Handoff", "Scholarship"]) {
    await tabs.getByRole("link", { name: tab }).click();
    await expect(tabs.getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
    await noOverflow(page);
    await noAxeViolations(page, `the ${tab} tab`);
  }
  await tabs.getByRole("link", { name: "Handoff" }).click();
  await expect(page.getByTestId("handoff-packet")).toContainText("Next three actions");
});

test("the driver diagram is edited as an outline and drawn as a diagram", async ({ page }) => {
  const text = `Discharge checklist visible at the bedside ${tag()}`;
  await openProject(page, DISCHARGE);
  await page.getByRole("navigation", { name: "Project workspace" }).getByRole("link", { name: "Drivers" }).click();
  await page.getByText("+ Add a primary driver").click();
  await page.getByLabel("Add a primary driver").fill(text);
  await page.getByRole("button", { name: "Add", exact: true }).last().click();
  await expect(page.locator("#driver-diagram")).toContainText(text.split(" ").slice(0, 2).join(" "));
  const item = page.getByRole("listitem").filter({ hasText: text }).last();
  await item.getByText("Edit", { exact: true }).click();
  await item.getByRole("button", { name: `Remove “${text}” and everything under it` }).click();
  await expect(page.getByText(text)).toHaveCount(0);
});

test("the committee sees the stalled queue", async ({ page }) => {
  await page.goto("/committee");
  const queue = page.getByTestId("stalled-queue");
  await expect(queue).toContainText("Time to first antibiotic dose in suspected sepsis");
  await expect(queue).toContainText("No PDSA entry or data point in 60 days.");
  // The flagship project is not stalled, but its 20-day unaccepted handoff is a signal (C1).
  await expect(queue).toContainText(/Handoff to Dr\. P\. Whitfield unaccepted for \d+ days/);
  await noAxeViolations(page, "the committee dashboard");
});
