import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { NpShortcuts } from '@/components/np-shortcuts';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';

import { IssuesView } from './issues-view.js';
import { NewIssueButton } from './new-issue-button.js';

/**
 * Route `/issues`: every issue as a list or a board (`?view=board`, §J 1). The header's split button creates one
 * issue (`new` dialog) or opens batch entry (`intake` drawer, iteration 3 §G); `C` opens the create dialog and ⌘K the
 * search. The page stays mounted underneath its child routes (`new`, `intake`, the `:issueId` covering page).
 */
export default function IssuesPage(): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <PageContainer>
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
      <IssuesView
        emptyTitle={t('np.issues.emptyTitle')}
        emptyDescription={t('np.issues.emptyDescription')}
        emptyAction={<NewIssueButton variant='outline' />}
      />
      <Outlet />
    </PageContainer>
  );
}
