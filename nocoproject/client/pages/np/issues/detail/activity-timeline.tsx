import { useTranslation } from '@nocobase/i18n/client';
import { CircleDotIcon, PlayIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { NpActorAvatar } from '@/components/np-actor-avatar';
import { NpPulse, NpStatusBadge } from '@/components/np-badges';
import { NpVirtualList } from '@/components/np-virtual-list';

import { runTriggerType } from '../../detail-normalize.js';
import { failureReasonKey, useNpFormatters } from '../../format.js';
import type {
  IssueActivity,
  RunSummary,
  StatusCatalogEntry,
} from '../../types.js';
import { ThreadCard, type ThreadContext } from './comment-thread.js';
import {
  STATUS_CHANGE_LABELS,
  activityChange,
  activityLabel,
  type TimelineEntry,
} from './timeline.js';

export interface ActivityTimelineProps extends ThreadContext {
  readonly entries: readonly TimelineEntry[];
  readonly statusCatalog: readonly StatusCatalogEntry[];
}

/**
 * Comments as threads, system activity as compact rows, and agent runs inline, oldest first. Past 100 entries the
 * list is virtualized against the detail's scrolling column (§H 8).
 */
export function ActivityTimeline({
  entries,
  statusCatalog,
  ...context
}: ActivityTimelineProps): ReactElement {
  const { agentName } = context;
  const { t } = useTranslation();
  if (entries.length === 0) {
    return (
      <p className='text-sm text-muted-foreground'>{t('np.activity.empty')}</p>
    );
  }
  return (
    <NpVirtualList
      items={entries}
      itemKey={(entry) => entry.key}
      label={t('np.activity.title')}
      renderItem={(entry) =>
        entry.kind === 'thread' ? (
          <ThreadCard thread={entry.thread} context={context} />
        ) : entry.kind === 'activity' ? (
          <ActivityRow
            activity={entry.activity}
            statusCatalog={statusCatalog}
            agentName={agentName}
          />
        ) : (
          <RunRow run={entry.run} agentName={agentName} />
        )
      }
    />
  );
}

function ActivityRow({
  activity,
  statusCatalog,
  agentName,
}: {
  readonly activity: IssueActivity;
  readonly statusCatalog: readonly StatusCatalogEntry[];
  readonly agentName: ActivityTimelineProps['agentName'];
}): ReactElement {
  const { t } = useTranslation();
  const format = useNpFormatters();
  const label = activityLabel(activity.action);
  const actor =
    activity.actorName ??
    (activity.actorType === 'agent' ? agentName(activity.actorId) : null) ??
    (activity.actorType === 'system'
      ? t('np.activity.system')
      : t('np.common.unknown'));
  const change = activityChange(activity.details);
  return (
    <div className='flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm text-muted-foreground'>
      <CircleDotIcon className='size-3.5 shrink-0' aria-hidden='true' />
      <NpActorAvatar type={activity.actorType} name={actor} size='xs' />
      <span className='font-medium text-foreground'>{actor}</span>
      <span>{t(`np.activity.actions.${label}`)}</span>
      {STATUS_CHANGE_LABELS.has(label) && change.to ? (
        <>
          {change.from ? (
            <NpStatusBadge statusKey={change.from} catalog={statusCatalog} />
          ) : null}
          {change.from ? <span aria-hidden='true'>→</span> : null}
          <NpStatusBadge statusKey={change.to} catalog={statusCatalog} />
        </>
      ) : null}
      <time
        dateTime={activity.createdAt}
        title={format.dateTime(activity.createdAt)}
        className='ml-auto text-xs'
      >
        {format.relative(activity.createdAt)}
      </time>
    </div>
  );
}

function RunRow({
  run,
  agentName,
}: {
  readonly run: RunSummary;
  readonly agentName: ActivityTimelineProps['agentName'];
}): ReactElement {
  const { t } = useTranslation();
  const format = useNpFormatters();
  const name =
    run.agentName ?? agentName(run.agentId) ?? t('np.common.unknownAgent');
  const trigger = runTriggerType(run);
  const active =
    run.status === 'running' ||
    run.status === 'dispatched' ||
    run.status === 'queued';
  const at = run.finishedAt ?? run.startedAt ?? run.createdAt;
  return (
    <div className='flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1 text-sm text-muted-foreground'>
      {active ? (
        <NpPulse />
      ) : (
        <PlayIcon className='size-3.5 shrink-0' aria-hidden='true' />
      )}
      <span className='text-foreground'>
        {t(`np.activity.run.${run.status}`, { name })}
      </span>
      {trigger ? (
        <span className='text-xs'>
          · {t(`np.trigger.${trigger}`, { defaultValue: trigger })}
        </span>
      ) : null}
      {run.status === 'failed' && run.failureReason ? (
        <span className='text-xs text-destructive'>
          ·{' '}
          {t(failureReasonKey(run.failureReason), {
            defaultValue: run.failureReason,
          })}
        </span>
      ) : null}
      <Link
        to={`runs/${encodeURIComponent(run.id)}`}
        className='text-xs underline-offset-4 hover:text-foreground hover:underline'
      >
        {t('np.runs.viewTranscript')}
      </Link>
      <time
        dateTime={at}
        title={format.dateTime(at)}
        className='ml-auto text-xs'
      >
        {format.relative(at)}
      </time>
    </div>
  );
}
