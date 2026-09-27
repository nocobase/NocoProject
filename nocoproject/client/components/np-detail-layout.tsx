import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface NpDetailLayoutProps {
  /** The record's own column: heading, content, activity. It scrolls on its own from the `lg` breakpoint. */
  readonly main: ReactNode;
  /** The properties column, a fixed `w-80` from `lg` up and stacked under the main column below it. */
  readonly aside: ReactNode;
  readonly asideLabel: string;
  readonly className?: string;
}

/**
 * The three-column detail page of §H 3 (navigation, main, properties): the main column is `flex-1 min-w-0`, the right
 * column a fixed `w-80` with its own scroll, and narrow screens fold both into one column. Used by the issue, project
 * and knowledge details so every record page shares one frame.
 */
export function NpDetailLayout({
  main,
  aside,
  asideLabel,
  className,
}: NpDetailLayoutProps): ReactElement {
  return (
    <div
      className={cn(
        'flex min-h-full flex-col lg:h-full lg:flex-row',
        className,
      )}
    >
      <div className='flex min-w-0 flex-1 flex-col lg:min-h-0 lg:overflow-y-auto'>
        {main}
      </div>
      <aside
        aria-label={asideLabel}
        className='border-t bg-muted/30 lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-l'
      >
        {aside}
      </aside>
    </div>
  );
}
