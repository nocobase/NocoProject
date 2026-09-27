import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery } from '@tanstack/react-query';
import { AlertCircleIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link, Outlet, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { RouteChildPage } from '@/components/route-child-page';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';

import { fetchAgents, fetchIssueDetail, fetchMe } from '../../api.js';
import { npKeys } from '../../constants.js';
import type { AgentListItem, IssueDetail, Me } from '../../types.js';
import { IssueMain } from './issue-main.js';
import { PropertiesPanel } from './properties-panel.js';

/**
 * Route `/issues/:issueId`: a covering child page over the issue list, so the list keeps its filters and scroll.
 * Main column (title, description, activity, composer) beside a properties panel with the execution log; resizable
 * on desktop, stacked on narrow screens. The transcript dialog (`runs/:runId`) renders in the outlet beside the layer.
 *
 * The detail refreshes through the `np:issues` subscription owned by the list page underneath.
 */
export default function IssueDetailPage(): ReactElement {
  const { issueId = '' } = useParams();
  return (
    <>
      <RouteChildPage>
        <IssueDetailView key={issueId} issueId={issueId} />
      </RouteChildPage>
      <Outlet />
    </>
  );
}

function IssueDetailView({
  issueId,
}: {
  readonly issueId: string;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const isMobile = useIsMobile();

  const detail = useQuery({
    queryKey: npKeys.issue(issueId),
    queryFn: ({ signal }) => fetchIssueDetail(api, issueId, signal),
    retry: (count, error) =>
      !(error instanceof ApiClientError && [403, 404].includes(error.status)) &&
      count < 2,
  });
  const agents = useQuery({
    queryKey: npKeys.agents,
    queryFn: () => fetchAgents(api),
  });
  const me = useQuery({ queryKey: npKeys.me, queryFn: () => fetchMe(api) });

  if (detail.isError && !detail.data) {
    const status =
      detail.error instanceof ApiClientError ? detail.error.status : undefined;
    return (
      <div className='space-y-4 p-6 md:p-8'>
        <Breadcrumbs />
        <Alert variant='destructive'>
          <AlertCircleIcon />
          <AlertTitle>{t('np.issue.loadFailed')}</AlertTitle>
          <AlertDescription>
            {status === 404
              ? t('np.issue.notFound')
              : status === 403
                ? t('np.common.forbidden')
                : t('np.common.requestFailed')}
          </AlertDescription>
          <AlertAction>
            {status === 404 || status === 403 ? (
              <Button
                variant='outline'
                size='sm'
                nativeButton={false}
                render={<Link to='..' relative='path' />}
              >
                {t('np.issue.backToList')}
              </Button>
            ) : (
              <Button
                variant='outline'
                size='sm'
                onClick={() => void detail.refetch()}
              >
                {t('status.retry')}
              </Button>
            )}
          </AlertAction>
        </Alert>
      </div>
    );
  }

  if (!detail.data) {
    return (
      <div
        role='status'
        aria-label={t('status.loading')}
        className='space-y-4 p-6 md:p-8'
      >
        <Skeleton className='h-4 w-40' />
        <Skeleton className='h-8 w-2/3' />
        <Skeleton className='h-24 w-full' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  return (
    <IssueLayout
      detail={detail.data}
      agents={agents.data ?? []}
      me={me.data}
      isMobile={isMobile}
    />
  );
}

function IssueLayout({
  detail,
  agents,
  me,
  isMobile,
}: {
  readonly detail: IssueDetail;
  readonly agents: readonly AgentListItem[];
  readonly me: Me | undefined;
  readonly isMobile: boolean;
}): ReactElement {
  const main = <IssueMain detail={detail} agents={agents} />;
  const panel = <PropertiesPanel detail={detail} agents={agents} me={me} />;

  if (isMobile) {
    return (
      <div className='flex flex-col'>
        {main}
        <div className='border-t'>{panel}</div>
      </div>
    );
  }

  return (
    <ResizablePanelGroup orientation='horizontal' className='h-full'>
      <ResizablePanel defaultSize='70%' minSize='45%'>
        <div className='flex h-full min-h-0 flex-col'>{main}</div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize='30%' minSize='22%' maxSize='45%'>
        <div className='h-full overflow-y-auto bg-muted/30'>{panel}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
