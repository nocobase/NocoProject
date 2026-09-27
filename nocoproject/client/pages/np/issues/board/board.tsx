import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useTranslation } from '@nocobase/i18n/client';
import { type ReactElement, useMemo, useState } from 'react';

import { NpStartDialog } from '@/components/np-start-dialog';
import { NpStatusBadge } from '@/components/np-badges';
import { cn } from '@/lib/utils';

import { statusLabelKey } from '../../constants.js';
import type {
  BoardGroup,
  IssueListItem,
  StatusCatalogEntry,
} from '../../types.js';
import { BoardCard, BoardCardFace, type IssueLink } from './board-card.js';
import {
  type BoardColumn,
  buildBoardColumns,
  resolveDropStatus,
  boardCollisionDetection,
} from './board-model.js';
import { useBoardMove } from './use-board-move.js';

function Column({
  column,
  catalog,
  issueLink,
}: {
  readonly column: BoardColumn;
  readonly catalog: readonly StatusCatalogEntry[];
  readonly issueLink?: IssueLink;
}): ReactElement {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.statusKey}`,
  });
  const headingId = `np-board-column-${column.statusKey}`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-lg bg-muted/50 transition-colors',
        isOver && 'bg-muted ring-2 ring-ring/40',
      )}
    >
      <h3
        id={headingId}
        className='flex items-center gap-2 px-3 pt-3 pb-2 text-sm font-medium'
      >
        <NpStatusBadge statusKey={column.statusKey} catalog={catalog} />
        <span className='text-xs text-muted-foreground tabular-nums'>
          {column.issues.length}
        </span>
      </h3>
      <SortableContext
        id={column.statusKey}
        items={column.issues.map((issue) => issue.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul
          ref={setNodeRef}
          className='flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2'
        >
          {column.issues.map((issue) => (
            <BoardCard key={issue.id} issue={issue} issueLink={issueLink} />
          ))}
          {column.issues.length === 0 ? (
            <li className='flex flex-1 items-center justify-center rounded-lg border border-dashed p-4 text-xs text-muted-foreground'>
              {t('np.board.emptyColumn')}
            </li>
          ) : null}
        </ul>
      </SortableContext>
    </section>
  );
}

/**
 * The issue board (§J 1): a column per workflow status, cards dragged between columns to change status. Order inside
 * a column follows the server (latest activity first) and is not persisted, so a drop within the same column does
 * nothing.
 */
export function IssueBoard({
  groups,
  catalog,
  issueLink,
}: {
  readonly groups: readonly BoardGroup[];
  readonly catalog: readonly StatusCatalogEntry[];
  /** Where a card's title links; defaults to the issue beside the current page, keeping the query string. */
  readonly issueLink?: IssueLink;
}): ReactElement {
  const { t } = useTranslation();
  const move = useBoardMove(catalog);
  const [active, setActive] = useState<IssueListItem | null>(null);
  const columns = useMemo(
    () => buildBoardColumns(catalog, groups, move.overrides),
    [catalog, groups, move.overrides],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const findIssue = (id: string): IssueListItem | undefined =>
    columns.flatMap((column) => column.issues).find((issue) => issue.id === id);
  const statusName = (statusKey: string | null): string =>
    statusKey ? t(statusLabelKey(statusKey), { defaultValue: statusKey }) : '';
  const announcements: Announcements = {
    onDragStart: ({ active: item }) =>
      t('np.board.announce.start', {
        identifier: findIssue(String(item.id))?.identifier ?? '',
      }),
    onDragOver: ({ over }) =>
      over
        ? t('np.board.announce.over', {
            status: statusName(resolveDropStatus(String(over.id), columns)),
          })
        : undefined,
    onDragEnd: ({ over }) =>
      over
        ? t('np.board.announce.end', {
            status: statusName(resolveDropStatus(String(over.id), columns)),
          })
        : t('np.board.announce.cancel'),
    onDragCancel: () => t('np.board.announce.cancel'),
  };

  function handleDragStart(event: DragStartEvent): void {
    setActive(findIssue(String(event.active.id)) ?? null);
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActive(null);
    const issue = findIssue(String(event.active.id));
    const target = resolveDropStatus(
      event.over ? String(event.over.id) : null,
      columns,
    );
    if (issue && target) move.drop(issue, target);
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={boardCollisionDetection}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: t('np.board.announce.instructions'),
          },
        }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActive(null)}
      >
        <div
          className='-mx-1 flex min-h-96 gap-3 overflow-x-auto px-1 pb-2'
          aria-label={t('np.board.label')}
          role='region'
        >
          {columns.map((column) => (
            <Column
              key={column.statusKey}
              column={column}
              catalog={catalog}
              issueLink={issueLink}
            />
          ))}
        </div>
        <DragOverlay>
          {active ? <BoardCardFace issue={active} dragging /> : null}
        </DragOverlay>
      </DndContext>
      <NpStartDialog
        request={move.startRequest}
        onDecide={move.decide}
        onCancel={move.cancel}
      />
    </>
  );
}
