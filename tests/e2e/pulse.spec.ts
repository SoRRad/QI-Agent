import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { TRAINEE_BASE_URL } from "./env";

/**
 * Phase 6: Pulse at 375px and 1280px, with axe on every page.
 *
 * The default server's identity is the chair; the trainee server's is a
 * trainee who has not yet responded (playwright.config.ts). Flows that change
 * state run once per suite, in the mobile project — 375px is the primary
 * target — so the two viewports never race to submit the same response.
 */

async function noAxeViolations(page: Page, where: string) {
  await expect(page).toHaveTitle(/QI Agent/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id} (${v.nodes.length})`), `axe on ${where}`).toEqual([]);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

const DATA_ACCESS = "Data access is the rate-limiting step";

test("the landing view leads with what changed, and every Pulse page passes axe", async ({ page }) => {
  await page.goto("/pulse");
  await expect(page.getByRole("heading", { level: 1, name: "You reported, we changed" })).toBeVisible();
  await expect(page.getByTestId("closed-barriers")).toContainText(DATA_ACCESS);
  await noOverflow(page);
  await noAxeViolations(page, "the Pulse landing view");

  const tabs = page.getByRole("navigation", { name: "Pulse" });
  for (const [tab, heading] of [
    ["Survey", "Quarterly survey"],
    ["My responses", "My responses"],
    ["Barriers", "Barriers log"],
    ["Manage", "Manage the pulse survey"],
  ] as const) {
    await tabs.getByRole("link", { name: tab }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await noOverflow(page);
    await noAxeViolations(page, `the ${tab} tab`);
  }
});

test("the chair sees response rate by program, counted from participation", async ({ page }) => {
  await page.goto("/pulse/manage");
  const rates = page.getByTestId("response-rates");
  await expect(rates.getByRole("row", { name: /General Surgery Residency/ })).toContainText("5 of 9");
  await expect(rates.getByRole("row", { name: /Internal Medicine Residency/ })).toContainText(/\d+ of 14/);
  await expect(page.getByTestId("survey-results")).toContainText("How much protected time");
  for (const sub of ["Theme responses", "Digest"]) {
    await page.getByRole("navigation", { name: "Manage pulse" }).getByRole("link", { name: sub }).click();
    await noOverflow(page);
    await noAxeViolations(page, `manage: ${sub}`);
  }
});

test("the barriers log filters by status, and only the chair sees the responses behind a theme", async ({ page }) => {
  await page.goto("/pulse/barriers?status=closed");
  const log = page.getByTestId("barriers-log");
  await expect(log).toContainText(DATA_ACCESS);
  await expect(log).not.toContainText("No protected time");
  await log.getByRole("link", { name: DATA_ACCESS }).click();
  await expect(page.getByTestId("barrier-responses")).toContainText("I could not get the data I needed");
  await noAxeViolations(page, "a closed barrier, as the chair");

  // The same page as a trainee: the summary, never the responses.
  const url = new URL(page.url());
  await page.goto(`${TRAINEE_BASE_URL}${url.pathname}`);
  await expect(page.getByRole("heading", { level: 1, name: DATA_ACCESS })).toBeVisible();
  await expect(page.getByText("The responses behind this theme are seen only by the chair")).toBeVisible();
  await expect(page.getByText("I could not get the data I needed")).toHaveCount(0);
  await noAxeViolations(page, "a closed barrier, as a trainee");
});

test("a trainee responds: a block has no override, a warning can be confirmed, and the response comes back under My responses", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-375", "One response per trainee per quarter: submitted once, at the primary viewport.");
  await page.goto(`${TRAINEE_BASE_URL}/pulse/survey`);
  await expect(page.getByRole("heading", { level: 1, name: "Quarterly survey" })).toBeVisible();
  await noAxeViolations(page, "the survey form");
  await noOverflow(page);

  await page.getByRole("group", { name: /How confident are you/ }).getByLabel("3").check();
  const barrier = page.getByLabel(/What got in the way of improvement work/);

  // Block tier: an identifier. No confirmation is offered.
  await barrier.fill("Chasing the report for MRN 00123456 took weeks.");
  await page.getByRole("button", { name: "Send my response" }).click();
  await expect(page.getByText("This can't be sent: it looks like it contains a patient identifier")).toBeVisible();
  await expect(page.getByText("I confirm nothing highlighted identifies a patient.")).toHaveCount(0);

  // Warn tier: a date. Confirm and send.
  await barrier.fill("Our data request from 14 March 2026 was still open when my rotation ended, so the project stopped.");
  await page.getByRole("button", { name: "Send my response" }).click();
  await expect(page.getByText("Please check before sending")).toBeVisible();
  await page.getByText("I confirm nothing highlighted identifies a patient.").click();
  await page.getByRole("button", { name: "Send my response" }).click();

  await expect(page).toHaveURL(/\/pulse\/mine\?submitted=1/);
  await expect(page.getByText("Thank you. Your response was sent.")).toBeVisible();
  await expect(page.getByText(/anonymous/).first()).toBeVisible();
  await expect(page.getByText("was still open when my rotation ended")).toBeVisible();
  await noAxeViolations(page, "My responses");

  await page.goto(`${TRAINEE_BASE_URL}/pulse/survey`);
  await expect(page.getByText(/You have responded to the 2026-Q3 survey/)).toBeVisible();
});

test("the chair themes responses, moves a barrier to closed, and publishes a digest of closed barriers", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-375", "Changes shared state: run once, at the primary viewport.");
  await page.goto("/pulse/manage/themes");
  await page.getByRole("button", { name: "Propose themes" }).click();
  const proposals = page.getByTestId("theme-proposals");
  await expect(proposals).toBeVisible();
  const first = proposals.getByRole("listitem").first();
  const label = await first.getByLabel("Theme").inputValue();
  await noAxeViolations(page, "theme proposals");
  await first.getByRole("button", { name: "Raise as a barrier" }).click();
  await expect(first).toContainText(`Saved: “${label}”`);

  await page.goto("/pulse/barriers?status=raised");
  await page.getByTestId("barriers-log").getByRole("link", { name: label }).click();
  await page.getByLabel("Next step").selectOption({ label: "Decided" });
  await page.getByLabel("Decision").fill("The committee agreed to share last year's project templates in the library.");
  await page.getByRole("button", { name: /^Move to/ }).click();
  await expect(page.getByText("Status updated.")).toBeVisible();
  await expect(page.getByText("Decision recorded")).toBeVisible();

  await page.getByLabel("What changed, for trainees").fill("Last year's project templates are now in the library, linked from intake.");
  await page.getByRole("button", { name: "Move to closed" }).click();
  await expect(page.getByText("What changed", { exact: true })).toBeVisible();

  await page.goto("/pulse/manage/digest");
  await expect(page.getByTestId("digest-pending")).toContainText(label);
  await page.getByRole("button", { name: "Draft the digest" }).click();
  await expect(page.getByLabel("Headline")).toBeVisible();
  await noAxeViolations(page, "the digest draft");
  await page.getByRole("button", { name: "Publish to trainees" }).click();
  await expect(page).toHaveURL(/\/pulse\?published=1/);
  await expect(page.getByTestId("digest-items")).toContainText("Last year's project templates are now in the library");
});
