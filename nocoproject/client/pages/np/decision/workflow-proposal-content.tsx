import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery } from '@tanstack/react-query';
import { type ReactElement, useState } from 'react';
import { Link } from 'react-router';

import { NpTag } from '@/components/np-tag';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { fetchWorkflowProposal } from '../api-phase2.js';
import { statusLabelKey } from '../constants.js';
import { npKeys } from '../constants.js';
import type { InboxItem } from '../types.js';
import type {
  WorkflowDiff,
  WorkflowDiffChange,
  WorkflowProposal,
} from '../types-phase2.js';
import { ActorIcons } from '../config/workflow-views.js';

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * What a workflow template proposal would change (docs/design/ui-design.md §8.1, NP-82 §4–§5): the agent's reason,
 * a structured diff summary against the template's current revision (statuses, transitions, stage actions), the
 * `runExecutor` presets highlighted separately (they wake an agent without the owner's confirmation), how many
 * projects the template affects, and the full proposed definition behind a toggle. Accept / reject run through the
 * server's `payload.actions` (the generic decision runner), not from here.
 */
export function WorkflowProposalContent({
  item,
}: {
  readonly item: InboxItem;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const payload = item.payload ?? {};
  const proposalId = text(payload.proposalId);
  const proposal = useQuery({
    queryKey: npKeys.workflowProposal(proposalId ?? ''),
    queryFn: ({ signal }) =>
      fetchWorkflowProposal(api, proposalId ?? '', signal),
    enabled: proposalId !== null,
  });
  const [full, setFull] = useState(false);

  if (!proposalId) return <NoLonger />;
  if (proposal.isPending) {
    return (
      <div className='space-y-2'>
        <Skeleton className='h-4 w-40' />
        <Skeleton className='h-24 w-full' />
      </div>
    );
  }
  if (!proposal.data) return <NoLonger />;
  const data = proposal.data;
  const statusName = (key: string): string => {
    if (key === '*') return t('np.workflows.any');
    const status = data.definition.statuses.find((entry) => entry.key === key);
    return t(statusLabelKey(key), { defaultValue: status?.name ?? key });
  };

  return (
    <div className='space-y-3'>
      <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm'>
        <dt className='text-muted-foreground'>
          {t('np.decision.workflow.template')}
        </dt>
        <dd className='flex min-w-0 flex-wrap items-center gap-2'>
          {data.templateId ? (
            <Link
              to={`/config/workflows/${encodeURIComponent(data.templateId)}`}
              className='truncate font-medium hover:underline'
            >
              {data.templateName ?? data.name ?? ''}
            </Link>
          ) : (
            <span className='truncate font-medium'>
              {data.name ?? data.copyFromName ?? ''}
            </span>
          )}
          <NpTag tone={data.kind === 'copy' ? 'blue' : 'grey'}>
            {t(`np.decision.workflow.kind.${data.kind}`)}
          </NpTag>
        </dd>
        <dt className='text-muted-foreground'>
          {t('np.decision.workflow.reason')}
        </dt>
        <dd className='wrap-anywhere'>{data.reason}</dd>
        <dt className='text-muted-foreground'>
          {t('np.decision.workflow.affectedProjects')}
        </dt>
        <dd>{data.affectedProjectCount}</dd>
      </dl>
      {data.outdated ? (
        <p className='rounded-md border border-attention/40 bg-attention/10 px-3 py-2 text-sm text-attention-foreground'>
          {t('np.decision.workflow.outdated')}
        </p>
      ) : null}
      {data.diff.runExecutorAgents.length > 0 ? (
        <ul className='space-y-1 rounded-md border border-attention/40 bg-attention/10 px-3 py-2 text-sm'>
          {data.diff.runExecutorAgents.map((entry) => (
            <li key={`${entry.statusKey}:${entry.agentId}`}>
              {t('np.decision.workflow.runExecutorHighlight', {
                status: statusName(entry.statusKey),
                agent: entry.agentName ?? entry.agentId,
              })}
            </li>
          ))}
        </ul>
      ) : null}
      <div className='flex items-center justify-between gap-2'>
        <p className='text-xs text-muted-foreground'>
          {t('np.decision.workflow.against', {
            revision: data.baseRevision,
          })}
        </p>
        <Button variant='ghost' size='xs' onClick={() => setFull((v) => !v)}>
          {full
            ? t('np.decision.workflow.showDiff')
            : t('np.decision.workflow.showFull')}
        </Button>
      </div>
      {full ? (
        <FullDefinition definition={data.definition} />
      ) : (
        <DiffSummary diff={data.diff} statusName={statusName} />
      )}
    </div>
  );
}

function NoLonger(): ReactElement {
  const { t } = useTranslation();
  return (
    <p className='text-sm text-muted-foreground'>
      {t('np.decision.workflow.gone')}
    </p>
  );
}

function FullDefinition({
  definition,
}: {
  readonly definition: WorkflowProposal['definition'];
}): ReactElement {
  return (
    <pre className='max-h-96 overflow-auto rounded-md border bg-muted/40 px-4 py-3 font-mono text-xs whitespace-pre-wrap'>
      {JSON.stringify(definition, null, 2)}
    </pre>
  );
}

function ChangeLine<T>({
  change,
  render,
}: {
  readonly change: WorkflowDiffChange<T>;
  readonly render: (value: T) => ReactElement | string;
}): ReactElement {
  return (
    <span className='inline-flex items-center gap-1.5'>
      {render(change.from)}
      <span aria-hidden='true'>→</span>
      {render(change.to)}
    </span>
  );
}

/** The diff, one section per kind of change, empty sections omitted; `diff.empty` shows one line instead. */
function DiffSummary({
  diff,
  statusName,
}: {
  readonly diff: WorkflowDiff;
  readonly statusName: (key: string) => string;
}): ReactElement {
  const { t } = useTranslation();
  if (diff.empty) {
    return (
      <p className='text-sm text-muted-foreground'>
        {t('np.decision.workflow.noChange')}
      </p>
    );
  }
  const hasStatusChanges =
    diff.statuses.added.length > 0 ||
    diff.statuses.removed.length > 0 ||
    diff.statuses.changed.length > 0;
  const hasTransitionChanges =
    diff.transitions.added.length > 0 ||
    diff.transitions.removed.length > 0 ||
    diff.transitions.changed.length > 0;
  const actionChanges = diff.actions.filter(
    (entry) => entry.added.length > 0 || entry.removed.length > 0,
  );
  return (
    <div className='space-y-3 text-sm'>
      {diff.name ? (
        <p>
          {t('np.decision.workflow.nameChanged')}{' '}
          <ChangeLine change={diff.name} render={(value) => value} />
        </p>
      ) : null}
      {hasStatusChanges ? (
        <section className='space-y-1'>
          <h4 className='text-xs font-medium text-muted-foreground'>
            {t('np.decision.workflow.statuses')}
          </h4>
          <ul className='space-y-1'>
            {diff.statuses.added.map((status) => (
              <li key={`add:${status.key}`}>
                <NpTag tone='green'>{t('np.decision.workflow.added')}</NpTag>{' '}
                {status.name}
              </li>
            ))}
            {diff.statuses.removed.map((status) => (
              <li key={`remove:${status.key}`}>
                <NpTag tone='red'>{t('np.decision.workflow.removed')}</NpTag>{' '}
                {status.name}
              </li>
            ))}
            {diff.statuses.changed.map((status) => (
              <li key={`change:${status.key}`}>
                <NpTag tone='amber'>{t('np.decision.workflow.changed')}</NpTag>{' '}
                {status.name ? (
                  <ChangeLine change={status.name} render={(value) => value} />
                ) : (
                  status.key
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {hasTransitionChanges ? (
        <section className='space-y-1'>
          <h4 className='text-xs font-medium text-muted-foreground'>
            {t('np.decision.workflow.transitions')}
          </h4>
          <ul className='space-y-1'>
            {diff.transitions.added.map((transition) => (
              <li
                key={`add:${transition.from}>${transition.to}`}
                className='flex flex-wrap items-center gap-1.5'
              >
                <NpTag tone='green'>{t('np.decision.workflow.added')}</NpTag>
                {statusName(transition.from)}
                <span aria-hidden='true'>→</span>
                {statusName(transition.to)}
                <ActorIcons
                  actors={
                    transition.actors as readonly (
                      'user' | 'agent' | 'system'
                    )[]
                  }
                />
              </li>
            ))}
            {diff.transitions.removed.map((transition) => (
              <li
                key={`remove:${transition.from}>${transition.to}`}
                className='flex flex-wrap items-center gap-1.5'
              >
                <NpTag tone='red'>{t('np.decision.workflow.removed')}</NpTag>
                {statusName(transition.from)}
                <span aria-hidden='true'>→</span>
                {statusName(transition.to)}
              </li>
            ))}
            {diff.transitions.changed.map((transition) => (
              <li
                key={`change:${transition.from}>${transition.to}`}
                className='flex flex-wrap items-center gap-1.5'
              >
                <NpTag tone='amber'>{t('np.decision.workflow.changed')}</NpTag>
                {statusName(transition.from)}
                <span aria-hidden='true'>→</span>
                {statusName(transition.to)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {actionChanges.length > 0 ? (
        <section className='space-y-1'>
          <h4 className='text-xs font-medium text-muted-foreground'>
            {t('np.decision.workflow.actions')}
          </h4>
          <ul className='space-y-1'>
            {actionChanges.map((entry) => (
              <li key={entry.statusKey}>
                <span className='font-medium'>
                  {statusName(entry.statusKey)}
                </span>
                {': '}
                {entry.added.map((action) => (
                  <NpTag
                    key={`add:${entry.statusKey}:${action.type}`}
                    tone='green'
                    className='mr-1'
                  >
                    +{t(`np.workflows.stageActions.${action.type}`)}
                  </NpTag>
                ))}
                {entry.removed.map((action) => (
                  <NpTag
                    key={`remove:${entry.statusKey}:${action.type}`}
                    tone='red'
                    className='mr-1'
                  >
                    −{t(`np.workflows.stageActions.${action.type}`)}
                  </NpTag>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
