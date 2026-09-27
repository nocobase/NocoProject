import type { ReactElement } from 'react';
import { NavLink, useLocation } from 'react-router';

import { cn } from '@/lib/utils';

export interface NpRouteTab {
  /** The child route path relative to the page, such as `metrics`. */
  readonly path: string;
  readonly label: string;
}

/**
 * Page tabs that are child routes (`child-routes.md` §4): links styled as a line tab list, `aria-current='page'` on
 * the selected one, the query string kept. The page redirects its own bare URL to the default tab with
 * `useDefaultTabRedirect`.
 */
export function NpRouteTabs({
  tabs,
  label,
  keepSearch = true,
}: {
  readonly tabs: readonly NpRouteTab[];
  readonly label: string;
  readonly keepSearch?: boolean;
}): ReactElement {
  const location = useLocation();
  return (
    <nav aria-label={label} className='flex flex-wrap gap-1 border-b'>
      {tabs.map((tab) => (
        <NavLink
          key={tab.path}
          to={{
            pathname: tab.path,
            search: keepSearch ? location.search : undefined,
          }}
          className={cn(
            '-mb-px inline-flex h-9 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            'aria-[current=page]:border-primary aria-[current=page]:text-foreground',
          )}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
