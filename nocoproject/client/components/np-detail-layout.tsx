import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface NpDetailLayoutProps {
  /** The record's own column: heading, content, activity. It scrolls on its own from the `lg` breakpoint. */
  readonly main: ReactNode;
  /** The properties column, a fixed 20rem from `lg` up (in rem, so the compact preset does not narrow it). */
  readonly aside: ReactNode;
  readonly asideLabel: string;
  readonly className?: string;
}

/**
 * The three-column detail page of §H 3 (navigation, main, properties): the main column is `flex-1 min-w-0`, the right
 * column a fixed 20rem, both scrolling with the page, and narrow screens fold both into one column. Used by the issue, project
 * and knowledge details so every record page shares one frame.
 */
export function NpDetailLayout({
  main,
  aside,
  asideLabel,
  className,
}: NpDetailLayoutProps): ReactElement {
  return (
    // One scroll container (docs/design/ui-design.md §1.4): the covering page scrolls as a whole; neither column
    // scrolls on its own, and the side column stretches to the main column's height so its background runs through.
    <div className={cn('flex min-h-full flex-col lg:flex-row', className)}>
      <div className='flex min-w-0 flex-1 flex-col'>{main}</div>
      <aside
        aria-label={asideLabel}
        className='border-t bg-muted/30 lg:w-[20rem] lg:shrink-0 lg:border-t-0 lg:border-l'
      >
        {aside}
      </aside>
    </div>
  );
}
