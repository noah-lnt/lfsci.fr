import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const BLOCKING = new Set(["serious", "critical"]);

export async function assertAccessible(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = results.violations.filter((violation) => BLOCKING.has(violation.impact ?? ""));
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    `axe on ${label}`,
  ).toEqual([]);
}
