import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 3: Ask, tutor mode, devil's advocate, the library, and library admin —
 * at 375px and 1280px, with axe on every page.
 */

async function noAxeViolations(page: Page, where: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id} (${v.nodes.length})`), `axe on ${where}`).toEqual([]);
}

const notice = (page: Page) => page.getByRole("alert").filter({ hasText: /identifier|check before sending/i });

async function ask(page: Page, question: string) {
  await page.goto("/ask");
  await page.getByLabel("Your question").fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

test("answers from the library with a source that opens the document", async ({ page }) => {
  await ask(page, "What are the five required elements of an aim statement?");
  const result = page.getByText("Answer from the library");
  await expect(result).toBeVisible();
  await expect(page.getByText("Direction and magnitude, as a number")).toBeVisible();

  const source = page.getByRole("link", { name: "The Aim Statement Standard" });
  await expect(source).toBeVisible();
  await noAxeViolations(page, "an Ask answer");

  await source.click();
  await expect(page.getByRole("heading", { level: 1, name: "The Aim Statement Standard" })).toBeVisible();
  await noAxeViolations(page, "a library document");
});

test("says a question is not covered instead of answering it", async ({ page }) => {
  await ask(page, "What parking permit do residents get?");
  await expect(page.getByText("Not covered by the library")).toBeVisible();
  await expect(page.getByText("The document that should exist")).toBeVisible();
});

test("flags an answer that rests on a local placeholder", async ({ page }) => {
  await ask(page, "Do I need an IRB determination before collecting data for my QI project?");
  await expect(page.getByText("This relies on a document the institution has not yet written")).toBeVisible();
});

test("refuses a patient identifier, and offers no way past it", async ({ page }) => {
  await ask(page, "Why was MRN 00123456 readmitted?");
  await expect(notice(page)).toContainText("can't be sent");
  await expect(page.locator("mark")).toHaveText("00123456");
  // Block tier: no confirmation control exists.
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await noAxeViolations(page, "a PHI block");
});

test("lets a warning through only after the user confirms it", async ({ page }) => {
  await ask(page, "Parking permits issued on 14 March 2025 expire when?");
  await expect(notice(page)).toContainText("Please check before sending");
  await page.getByLabel("I confirm nothing highlighted identifies a patient.").check();
  await page.getByRole("button", { name: "Confirm and ask" }).click();
  await expect(page.getByText("Not covered by the library")).toBeVisible();
});

test("tutor asks one question at a time from the project record", async ({ page }) => {
  await page.goto("/ask?mode=tutor");
  await noAxeViolations(page, "tutor");
  await page.getByLabel("Work from a project (optional)").selectOption({ label: "Improve handoff communication" });
  await page.getByRole("button", { name: "Start" }).click();

  const turns = page.getByRole("list", { name: "Conversation" }).getByRole("listitem");
  await expect(turns).toHaveCount(1);
  await expect(turns.first()).toContainText("from what value to what value?");

  await page.getByLabel("Your reply").fill("Fewer missed items at shift change.");
  await page.getByRole("button", { name: "Reply" }).click();
  await expect(turns).toHaveCount(3);
  await expect(turns.last()).toContainText("over which months did you measure it?");
});

test("devil's advocate ranks the bad project's weaknesses", async ({ page }) => {
  await page.goto("/ask?mode=devil");
  await noAxeViolations(page, "devil's advocate");
  await page.getByLabel("Project").selectOption({ label: "Improve handoff communication" });
  await page.getByRole("button", { name: "Argue against it" }).click();
  await expect(page.getByRole("heading", { name: "Nobody with authority owns the change" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No balancing measure, so it can only report good news" })).toBeVisible();
  await noAxeViolations(page, "devil's advocate results");
});

test("the library lists local placeholders", async ({ page }) => {
  await page.goto("/ask?mode=library");
  await expect(page.getByRole("link", { name: "IRB / QI Determination Policy" })).toBeVisible();
  await noAxeViolations(page, "the library list");
});

test("library admin is available to the chair and opens an editor", async ({ page }) => {
  await page.goto("/committee/library");
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  await noAxeViolations(page, "library admin");
  await page.getByRole("link", { name: "Edit" }).first().click();
  await expect(page.getByLabel("Body (Markdown)")).toBeVisible();
  await noAxeViolations(page, "the library editor");
});

test("Ask modes do not overflow at 375px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-375", "375px only");
  for (const path of ["/ask", "/ask?mode=tutor", "/ask?mode=devil", "/ask?mode=library", "/ask/library/aim-statement-standard", "/committee/library"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
