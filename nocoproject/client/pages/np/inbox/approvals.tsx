import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery } from '@tanstack/react-query';
import { AlertCircleIcon, ShieldCheckIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';

import { fetchPendingApprovals } from '../api-iter2.js';
import { fetchMe } from '../api.js';
import { npKeys } from '../constants.js';
import { ApprovalItem } from '../issues/detail/approvals-card.js';

/**
 * Route `/inbox/approvals` (iteration 2 §D): the status changes waiting for the viewer's approval, across issues.
 * The inbox's `approval_pending` decisions are the main entry; this page lists them all in one place. It inherits the
 * `np-inbox` page grant.
 */
export default function ApprovalsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const approvals = useQuery({
    queryKey: npKeys.approvals,
    queryFn: ({ signal }) => fetchPendingApprovals(api, signal),
  });
  const me = useQuery({ queryKey: npKeys.me, queryFn: () => fetchMe(api) });

  let content: ReactElement;
  if (approvals.isError && !approvals.data) {
    content = (
      <Alert variant='destructive'>
        <AlertCircleIcon />
        <AlertTitle>{t('np.approvals.loadFailed')}</AlertTitle>
        <AlertDescription>{t('np.common.requestFailed')}</AlertDescription>
        <AlertAction>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void approvals.refetch()}
          >
            {t('status.retry')}
          </Button>
        </AlertAction>
      </Alert>
    );
  } else if (!approvals.data) {
    content = (
      <div role='status' aria-label={t('status.loading')} className='space-y-2'>
        <Skeleton className='h-32 w-full rounded-lg' />
        <Skeleton className='h-32 w-full rounded-lg' />
      </div>
    );
  } else if (approvals.data.length === 0) {
    content = (
      <Empty className='border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <ShieldCheckIcon />
          </EmptyMedia>
          <EmptyTitle>{t('np.approvals.empty')}</EmptyTitle>
          <EmptyDescription>
            {t('np.approvals.emptyDescription')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    content = (
      <ul className='space-y-3'>
        {approvals.data.map((approval) => (
          <li key={approval.id} className='space-y-1'>
            <Link
              to={`/issues/${encodeURIComponent(approval.issueId)}`}
              className='inline-flex max-w-full items-center gap-2 text-sm hover:underline'
            >
              <span className='font-mono text-muted-foreground'>
                {approval.issueIdentifier ?? approval.issueId}
              </span>
              <span className='truncate font-medium'>
                {approval.issueTitle ?? ''}
              </span>
            </Link>
            <ApprovalItem
              issueId={approval.issueId}
              approval={approval}
              meUserId={me.data?.userId}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        <PageHeader
          title={t('np.approvals.pageTitle')}
          description={t('np.approvals.pageDescription')}
        />
        {content}
      </PageContainer>
    </RouteChildPage>
  );
}
