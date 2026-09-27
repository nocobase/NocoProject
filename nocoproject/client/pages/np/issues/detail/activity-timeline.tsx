import { useTranslation } from '@nocobase/i18n/client';
import {
  BotIcon,
  CircleDotIcon,
  PlayIcon,
  ReplyIcon,
  UserIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { NpPulse, NpStatusBadge } from '@/components/np-badges';
import { NpMarkdown } from '@/components/np-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { runTriggerType } from '../../detail-normalize.js';
import { useNpFormatters } from '../../format.js';
import type {
  CommentThread,
  IssueActivity,
  IssueComment,
  RunSummary,
  StatusCatalogEntry,
} from '../../types.js';
import {
  activityChange,
  activityLabel,
  type TimelineEntry,
} from './timeline.js';

export interface ActivityTimelineProps {
  readonly entries: readonly TimelineEntry[];
  readonly statusCatalog: readonly StatusCatalogEntry[];
  readonly agentName: (agentId: string | null | undefined) => string | null;
  readonly replyingToId: string | null;
  readonly onReply: (comment: IssueComment) => void;
}

/** Comments as threads, system activity as compact rows, and agent runs inline, oldest first. */
export function ActivityTimeline({
  entries,
  statusCatalog,
  agentName,
  replyingToId,
  onReply,
}: ActivityTimelineProps): ReactElement {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return (
      <p className='text-sm text-muted-foreground'>{t('np.activity.empty')}</p>
    );
  }
  return (
    <ol className='space-y-3'>
      {entries.map((entry) => (
        <li key={entry.key}>
          {entry.kind === 'thread' ? (
            <ThreadCard
              thread={entry.thread}
              agentName={agentName}
              replyingToId={replyingToId}
              onReply={onReply}
            />
          ) : entry.kind === 'activity' ? (
            <ActivityRow
              activity={entry.activity}
              statusCatalog={statusCatalog}
              agentName={agentName}
            />
          ) : (
            <RunRow run={entry.run} agentName={agentName} />
          )}
        </li>
      ))}
    </ol>
  );
}

function authorLabel(
  comment: IssueComment,
  agentName: ActivityTimelineProps['agentName'],
  fallback: string,
): string {
  return (
    comment.authorName ??
    (comment.authorType === 'agent' ? agentName(comment.authorId) : null) ??
    fallback
  );
}

function ThreadCard({
  thread,
  agentName,
  replyingToId,
  onReply,
}: {
  readonly thread: CommentThread;
  readonly agentName: ActivityTimelineProps['agentName'];
  readonly replyingToId: string | null;
  readonly onReply: (comment: IssueComment) => void;
}): ReactElement {
  if (thread.root.kind === 'system' && thread.replies.length === 0) {
    return <SystemComment comment={thread.root} />;
  }
  return (
    <article className='rounded-lg border bg-card text-card-foreground'>
      <CommentBlock
        comment={thread.root}
        agentName={agentName}
        highlighted={replyingToId === thread.root.id}
        onReply={onReply}
      />
      {thread.replies.length > 0 ? (
        <div className='space-y-0 border-t bg-muted/30'>
          {thread.replies.map((reply) => (
            <CommentBlock
              key={reply.id}
              comment={reply}
              agentName={agentName}
              highlighted={replyingToId === reply.id}
              onReply={onReply}
              nested
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function CommentBlock({
  comment,
  agentName,
  highlighted,
  onReply,
  nested = false,
}: {
  readonly comment: IssueComment;
  readonly agentName: ActivityTimelineProps['agentName'];
  readonly highlighted: boolean;
  readonly onReply: (comment: IssueComment) => void;
  readonly nested?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const format = useNpFormatters();
  const Icon = comment.authorType === 'agent' ? BotIcon : UserIcon;
  const name = authorLabel(comment, agentName, t('np.common.unknown'));
  return (
    <div
      className={cn(
        'group space-y-1.5 p-3',
        nested && 'pl-9',
        highlighted && 'bg-accent/50',
      )}
    >
      <header className='flex items-center gap-2 text-sm'>
        <span
          className='flex size-6 shrink-0 items-center justify-center rounded-full bg-muted'
          aria-hidden='true'
        >
          <Icon className='size-3.5 text-muted-foreground' />
        </span>
        <span className='truncate font-medium'>{name}</span>
        {comment.authorType === 'agent' ? (
          <Badge variant='outline'>{t('np.executor.agentMarker')}</Badge>
        ) : null}
        <time
          dateTime={comment.createdAt}
          title={format.dateTime(comment.createdAt)}
          className='text-xs text-muted-foreground'
        >
          {format.relative(comment.createdAt)}
        </time>
        <Button
          variant='ghost'
          size='xs'
          className='ml-auto text-muted-foreground'
          aria-label={t('np.comment.replyTo', { name })}
          onClick={() => onReply(comment)}
        >
          <ReplyIcon data-icon='inline-start' />
          {t('np.comment.reply')}
        </Button>
      </header>
      <NpMarkdown content={comment.content} className='pl-8' />
    </div>
  );
}

function SystemComment({
  comment,
}: {
  readonly comment: IssueComment;
}): ReactElement {
  const format = useNpFormatters();
  return (
    <div className='flex items-start gap-2 px-1 text-sm text-muted-foreground'>
      <CircleDotIcon className='mt-0.5 size-3.5 shrink-0' aria-hidden='true' />
      <NpMarkdown content={comment.content} className='flex-1' />
      <time dateTime={comment.createdAt} className='shrink-0 text-xs'>
        {format.relative(comment.createdAt)}
      </time>
    </div>
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
      <span className='font-medium text-foreground'>{actor}</span>
      <span>{t(`np.activity.actions.${label}`)}</span>
      {label === 'statusChanged' && change.to ? (
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
        <span className='text-xs text-destructive'>· {run.failureReason}</span>
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
