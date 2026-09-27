import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery } from '@tanstack/react-query';
import { AlertCircleIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { NpOnlineState } from '@/components/np-badges';
import { PageContainer } from '@/components/page-container';
import { RouteChildPage } from '@/components/route-child-page';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { fetchMembers } from '../../api-collab.js';
import { fetchAgents, fetchMe, fetchRuntimes } from '../../api.js';
import { isRuntimeOnline, npKeys } from '../../constants.js';
import { canEditAgent, viewerFrom } from '../../permissions.js';
import { AgentForm } from './agent-form.js';

/**
 * Route `/agents/:agentId` (§J 5): a covering child page over the agent list with the agent's editable settings.
 * The agent comes from `GET /np/agents` (the contract has no single-agent read), so an id that list does not hold is
 * reported as not found.
 */
export default function AgentDetailPage(): ReactElement {
  const { agentId = '' } = useParams();
  return (
    <RouteChildPage>
      <AgentDetailView key={agentId} agentId={agentId} />
    </RouteChildPage>
  );
}

function AgentDetailView({
  agentId,
}: {
  readonly agentId: string;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const agents = useQuery({
    queryKey: npKeys.agents,
    queryFn: () => fetchAgents(api),
  });
  const runtimes = useQuery({
    queryKey: npKeys.runtimes,
    queryFn: () => fetchRuntimes(api),
  });
  const members = useQuery({
    queryKey: npKeys.members,
    queryFn: () => fetchMembers(api),
  });
  const me = useQuery({ queryKey: npKeys.me, queryFn: () => fetchMe(api) });

  const agent = agents.data?.find((candidate) => candidate.id === agentId);

  if ((agents.isError && !agents.data) || (agents.data && !agent)) {
    return (
      <PageContainer>
        <Breadcrumbs />
        <Alert variant='destructive'>
          <AlertCircleIcon />
          <AlertTitle>{t('np.agentDetail.loadFailed')}</AlertTitle>
          <AlertDescription>
            {agents.data
              ? t('np.agentDetail.notFound')
              : t('np.common.requestFailed')}
          </AlertDescription>
          <AlertAction>
            {agents.data ? (
              <Button
                variant='outline'
                size='sm'
                nativeButton={false}
                render={<Link to='..' relative='path' />}
              >
                {t('np.agentDetail.backToList')}
              </Button>
            ) : (
              <Button
                variant='outline'
                size='sm'
                onClick={() => void agents.refetch()}
              >
                {t('status.retry')}
              </Button>
            )}
          </AlertAction>
        </Alert>
      </PageContainer>
    );
  }

  if (!agent) {
    return (
      <div
        role='status'
        aria-label={t('status.loading')}
        className='space-y-4 p-6 md:p-8'
      >
        <Skeleton className='h-4 w-40' />
        <Skeleton className='h-8 w-1/3' />
        <Skeleton className='h-64 w-full max-w-2xl' />
      </div>
    );
  }

  const viewer = viewerFrom(me.data?.userId, members.data);
  return (
    <PageContainer>
      <div className='space-y-2'>
        <Breadcrumbs />
        <div className='flex flex-wrap items-center gap-3'>
          <h1 className='font-heading text-xl font-semibold'>{agent.name}</h1>
          <Badge variant='outline'>{agent.provider}</Badge>
          <NpOnlineState online={isRuntimeOnline(agent)} />
        </div>
        <p className='text-sm text-muted-foreground'>
          {t('np.agentDetail.owner', { name: agent.ownerName ?? '—' })}
        </p>
      </div>
      {/* Keyed by the agent's update time so a save elsewhere reseeds the form instead of keeping a stale draft. */}
      <AgentForm
        key={agent.updatedAt ?? agent.id}
        agent={agent}
        runtimes={runtimes.data ?? []}
        agents={agents.data ?? []}
        members={members.data ?? []}
        canEdit={agent.canEdit ?? canEditAgent(viewer, agent)}
      />
    </PageContainer>
  );
}
