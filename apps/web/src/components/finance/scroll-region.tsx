import { cn } from "cn";
import type { ReactNode } from "react";

type Props = { label: string; children: ReactNode; className?: string; id?: string };

/**
 * WCAG 2.1 SC 2.1.1: a horizontally scrolling table must be reachable by
 * keyboard. The shadcn `Table` hard-codes `overflow-x-auto` on its own
 * container and exposes no way to focus it, so the scrolling is moved out to
 * this named region and the inner container is neutralised.
 */
export function ScrollRegion({ label, children, className, id }: Props) {
  return (
    <section
      id={id}
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable, which is exactly what axe's scrollable-region-focusable checks.
      tabIndex={0} // eslint-disable-line jsx-a11y/no-noninteractive-tabindex
      className={cn(
        "overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
        "[&_[data-slot=table-container]]:overflow-visible",
        className,
      )}
    >
      {children}
    </section>
  );
}
