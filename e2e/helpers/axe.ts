import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const BLOCKING = new Set(["serious", "critical"]);

// A button that just became disabled is mid-transition for 150 ms; axe sampled
// those blended colours as a contrast failure that no user can see.
const FREEZE =
  "*, *::before, *::after { transition: none !important; animation: none !important; }";

export async function assertAccessible(page: Page, label: string): Promise<void> {
  await page.addStyleTag({ content: FREEZE });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = results.violations.filter((violation) => BLOCKING.has(violation.impact ?? ""));
  expect(
    violations.map(
      (v) =>
        `${v.id}: ${v.nodes
          .map(
            (n) =>
              `${n.target.join(" ")} ${JSON.stringify({ any: n.any, all: n.all, html: n.html }).slice(0, 600)}`,
          )
          .join(", ")}`,
    ),
    `axe on ${label}`,
  ).toEqual([]);
}
