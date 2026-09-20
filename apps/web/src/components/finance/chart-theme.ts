"use client";

import { useEffect, useState } from "react";

export type ChartTheme = {
  grid: string;
  axis: string;
  series: string;
  surface: string;
  border: string;
};

const FALLBACK: ChartTheme = {
  grid: "#e2e8f0",
  axis: "#64748b",
  series: "#b11649",
  surface: "#ffffff",
  border: "#e2e8f0",
};

function read(style: CSSStyleDeclaration, token: string, fallback: string): string {
  const value = style.getPropertyValue(token).trim();
  return value === "" ? fallback : value;
}

/**
 * Recharts renders inline SVG, where a `var(--token)` fill does not follow a
 * theme switch: the values are resolved here and re-read when the class on
 * <html> changes.
 */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(FALLBACK);

  useEffect(() => {
    const root = document.documentElement;
    const resolve = () => {
      const style = getComputedStyle(root);
      setTheme({
        grid: read(style, "--border", FALLBACK.grid),
        axis: read(style, "--muted-foreground", FALLBACK.axis),
        series: read(style, "--chart-1", FALLBACK.series),
        surface: read(style, "--card", FALLBACK.surface),
        border: read(style, "--border", FALLBACK.border),
      });
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
