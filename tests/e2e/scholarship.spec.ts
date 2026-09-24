import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 7: the Scholarship tab at 375px and 1280px, with axe on every page.
 * Exit criteria in the browser: the SQUIRE draft for a project with no data
 * writes no results and marks what the author must add; the IRB pre-check
 * memo declares the missing local policy.
 */

async function noAxeViolations(page: Page, where: string) {
  await expect(page).toHaveTitle(/QI Agent/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id} (${v.nodes.length})`), `axe on ${where}`).toEqual([]);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

const DISCHARGE = "Discharge summary completion within 48 hours";
const BAD = "Improve handoff communication";

async function openScholarship(page: Page, title: string) {
  await page.goto("/projects");
  await page.getByRole("link", { name: title, exact: true }).click();
  await page.getByRole("navigation", { name: "Project workspace" }).getByRole("link", { name: "Scholarship" }).click();
  await expect(page.getByRole("navigation", { name: "Scholarship" })).toBeVisible();
}

test("venues are ranked for the project, and every scholarship page passes axe", async ({ page }) => {
  await openScholarship(page, DISCHARGE);
  const venues = page.getByTestId("venue-matches");
  await expect(venues).toContainText("Institutional GME QI Symposium");
  await expect(venues.getByRole("listitem").filter({ hasText: "Pediatric Quality & Safety" })).toContainText("out of scope");
  await noOverflow(page);
  await noAxeViolations(page, "scholarship venues");

  const nav = page.getByRole("navigation", { name: "Scholarship" });
  for (const section of ["SQUIRE draft", "Abstract", "IRB pre-check"]) {
    await nav.getByRole("link", { name: section }).click();
    await expect(nav.getByRole("link", { name: section })).toHaveAttribute("aria-current", "page");
    await noOverflow(page);
    await noAxeViolations(page, `scholarship: ${section}`);
  }
});

test("the SQUIRE draft for a project with no data writes no results, and downloads as Markdown", async ({ page }) => {
  await openScholarship(page, BAD);
  await page.getByRole("navigation", { name: "Scholarship" }).getByRole("link", { name: "SQUIRE draft" }).click();
  const results = page.getByTestId("squire-13");
  await expect(results).toContainText("AUTHOR INPUT NEEDED");
  await expect(results).toContainText("there are no results to report");
  await expect(page.getByTestId("squire-6")).toContainText("The aim is missing");
  await expect(page.getByTestId("squire-4")).toContainText("Standardised evening handoff using I-PASS");

  const href = await page.getByRole("link", { name: "Download as Markdown" }).getAttribute("href");
  const response = await page.request.get(href!);
  expect(response.headers()["content-disposition"]).toMatch(/attachment; filename="improve-handoff-communication-squire-draft\.md"/);
  expect(await response.text()).toMatch(/### 13\. Results[\s\S]*AUTHOR INPUT NEEDED/);
});

test("the abstract formatter counts words live against the venue's limit", async ({ page }) => {
  await openScholarship(page, DISCHARGE);
  await page.getByTestId("venue-matches").getByRole("link", { name: /the abstract for IHI Forum/ }).click();
  const total = page.getByTestId("abstract-total");
  await expect(total).toContainText("/ 350 words");
  const conclusions = page.getByLabel("Conclusions", { exact: true });
  await conclusions.fill("");
  const before = Number((await total.textContent())!.match(/(\d+) \//)![1]);
  await conclusions.fill("Moving drafting into an existing huddle did most of the work.");
  await expect(total).toContainText(`${before + 11} / 350 words`);
  await conclusions.fill("word ".repeat(400));
  await expect(total).toContainText("over the limit");
  await noAxeViolations(page, "the abstract formatter");
});

test("the IRB pre-check drafts a memo that declares the missing local policy", async ({ page }) => {
  await openScholarship(page, BAD);
  await page.getByRole("navigation", { name: "Scholarship" }).getByRole("link", { name: "IRB pre-check" }).click();
  const answer = async (question: RegExp, option: string) => page.getByRole("group", { name: question }).getByLabel(option, { exact: true }).check();
  await answer(/What is the project for/, "Both");
  await answer(/randomised/, "No");
  await answer(/accepted practice/, "Yes");
  await answer(/more risk/, "No");
  await answer(/beyond what care already records/, "Yes");
  // The follow-up appears only now.
  await answer(/From whom/, "Residents or fellows, about their education");
  await answer(/could identify a patient/, "No");
  await answer(/research grant/, "No");
  await answer(/present or publish/, "Yes");
  await page.getByRole("button", { name: "Screen and draft the memo" }).click();

  await expect(page).toHaveURL(/irb\?screened=1/);
  const memo = page.getByTestId("irb-memo");
  await expect(memo).toContainText("This is a screening, not a determination.");
  await expect(memo).toContainText("Ambiguous — needs a determination, not a guess");
  await expect(memo).toContainText("educational research");
  await expect(memo).toContainText("Gap:");
  await noAxeViolations(page, "the screening memo");
});
