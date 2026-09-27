import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from '@nocobase/i18n/client';
import { CalendarIcon, HourglassIcon, ListTreeIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link, type To, useLocation } from 'react-router';

import { NpLabelChip } from '@/components/np-labels';
import { NpExecutor, NpPriorityLabel } from '@/components/np-badges';
import { cn } from '@/lib/utils';

import { useNpFormatters } from '../../format.js';
import type { IssueListItem } from '../../types.js';

export type IssueLink = (issue: IssueListItem) => To;

/** The face of a board card; also rendered in the drag overlay. */
export function BoardCardFace({
  issue,
  dragging = false,
  issueLink,
}: {
  readonly issue: IssueListItem;
  readonly dragging?: boolean;
  readonly issueLink?: IssueLink;
}): ReactElement {
  const { t } = useTranslation();
  const format = useNpFormatters();
  const location = useLocation();
  return (
    <div
      className={cn(
        'space-y-2 rounded-lg border bg-card p-3 text-card-foreground shadow-xs',
        dragging && 'shadow-md ring-2 ring-ring/50',
      )}
    >
      <div className='flex items-center justify-between gap-2 text-xs'>
        <span className='font-mono text-muted-foreground'>
          {issue.identifier}
        </span>
        {issue.priority !== 'none' ? (
          <NpPriorityLabel priority={issue.priority} />
        ) : null}
      </div>
      <Link
        to={
          issueLink?.(issue) ?? {
            pathname: encodeURIComponent(issue.id),
            search: location.search,
          }
        }
        className='line-clamp-3 block text-sm font-medium wrap-anywhere hover:underline focus-visible:underline'
        onPointerDown={(event) => event.stopPropagation()}
      >
        {issue.title}
      </Link>
      {(issue.blockedCount ?? 0) > 0 || (issue.subtaskCount ?? 0) > 0 ? (
        <div className='flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground'>
          {(issue.blockedCount ?? 0) > 0 ? (
            <span className='inline-flex items-center gap-1'>
              <HourglassIcon className='size-3' aria-hidden='true' />
              {t('np.subtasks.waiting', { count: issue.blockedCount })}
            </span>
          ) : null}
          {(issue.subtaskCount ?? 0) > 0 ? (
            <span className='inline-flex items-center gap-1'>
              <ListTreeIcon className='size-3' aria-hidden='true' />
              {t('np.board.subtaskCount', { count: issue.subtaskCount })}
            </span>
          ) : null}
        </div>
      ) : null}
      {issue.labels && issue.labels.length > 0 ? (
        <div className='flex flex-wrap gap-1'>
          {issue.labels.map((label) => (
            <NpLabelChip key={label.id} label={label} />
          ))}
        </div>
      ) : null}
      <div className='flex items-center justify-between gap-2 text-xs text-muted-foreground'>
        <NpExecutor
          type={issue.executorType}
          name={issue.executorName}
          activeRunCount={issue.activeRunCount}
        />
        {issue.dueDate ? (
          <span
            className='inline-flex shrink-0 items-center gap-1'
            title={t('np.dates.due')}
          >
            <CalendarIcon className='size-3' aria-hidden='true' />
            {format.date(issue.dueDate)}
          </span>
        ) : (
          <span className='shrink-0' title={format.dateTime(issue.updatedAt)}>
            {format.relative(issue.updatedAt)}
          </span>
        )}
      </div>
    </div>
  );
}

/** A draggable card. The title link opens the issue; dragging starts after a few pixels so a click stays a click. */
export function BoardCard({
  issue,
  issueLink,
}: {
  readonly issue: IssueListItem;
  readonly issueLink?: IssueLink;
}): ReactElement {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id, data: { statusKey: issue.statusKey } });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'cursor-grab touch-none rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
      {...attributes}
      aria-roledescription={t('np.board.cardRole')}
      aria-label={`${issue.identifier} ${issue.title}`}
      {...listeners}
    >
      <BoardCardFace issue={issue} issueLink={issueLink} />
    </div>
  );
}
