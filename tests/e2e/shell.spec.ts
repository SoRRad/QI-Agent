import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Phase 0 smoke tests: the shell, the five-destination rule, and
 * accessibility. Accessibility is tested rather than asserted (addition D2),
 * at both 375px and 1280px, which the two Playwright projects supply.
 */

const DESTINATIONS = [
  { path: "/ask", heading: "Library-grounded answers" },
  { path: "/projects", heading: "Registry" },
  { path: "/charts", heading: "Measures and SPC studio" },
  { path: "/pulse", heading: "You reported, we changed" },
  { path: "/committee", heading: "Chair dashboard" },
] as const;

test("the root redirects into a destination", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/ask$/);
});

for (const { path, heading } of DESTINATIONS) {
  test(`${path} renders and is accessible`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    // Report the rule ids rather than a bare count, so a failure says what
    // broke without opening the trace.
    expect(
      results.violations.map((v) => `${v.id} (${v.nodes.length})`),
      `axe violations on ${path}`,
    ).toEqual([]);
  });
}

test("there is exactly one navigation landmark with five destinations", async ({ page }) => {
  await page.goto("/ask");

  // The five-destination rule is structural, so it is asserted structurally.
  // Depth belongs inside a destination, never in the nav bar.
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toHaveCount(1);
  await expect(nav.getByRole("link")).toHaveCount(5);
});

test("the current destination is marked for assistive technology", async ({ page }) => {
  await page.goto("/charts");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.locator("[aria-current='page']")).toHaveCount(1);
  await expect(nav.locator("[aria-current='page']")).toContainText("Charts");
});

test("every destination is reachable by keyboard from the skip link", async ({ page }) => {
  await page.goto("/ask");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
});

test("no primary flow overflows a 375px viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-375", "375px viewport only");

  for (const { path } of DESTINATIONS) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});
