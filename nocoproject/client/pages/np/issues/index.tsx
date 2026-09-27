import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { NpShortcuts } from '@/components/np-shortcuts';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';

import { IssuesView } from './issues-view.js';
import { NewIssueButton } from './new-issue-button.js';

/**
 * Route `/issues`: every issue as a board or a list (the board by default, the person's last choice remembered,
 * `?view=` overriding; §J 1, docs/design/ui-design.md §8.4). The header's split button creates one
 * issue (`new` dialog) or opens batch entry (`intake` drawer, iteration 3 §G); `C` opens the create dialog and ⌘K the
 * search. The page stays mounted underneath its child routes (`new`, `intake`, the `:issueId` covering page).
 */
export default function IssuesPage(): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  // The page is exactly the content area's height (docs/design/ui-design.md §8.4): header, toolbar, then the board
  // or table filling the rest and scrolling inside, so the page itself never scrolls.
  return (
    <PageContainer className='flex h-full min-h-0 flex-col gap-6 space-y-0'>
      <PageHeader
        title={t('np.issues.title')}
        description={t('np.issues.description')}
        actions={
          <>
            <NpShortcuts
              showTrigger
              onCreate={() =>
                void navigate({ pathname: 'new', search: location.search })
              }
            />
            <NewIssueButton />
          </>
        }
      />
      <div className='min-h-0 flex-1'>
        <IssuesView
          emptyTitle={t('np.issues.emptyTitle')}
          emptyDescription={t('np.issues.emptyDescription')}
          emptyAction={<NewIssueButton variant='outline' />}
        />
      </div>
      <Outlet />
    </PageContainer>
  );
}
