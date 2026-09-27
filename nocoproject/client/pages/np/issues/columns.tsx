import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router';

import { NpLabelChip } from '@/components/np-labels';

import { DataTableColumnHeader } from '@/components/data-table-column-header';
import {
  NpExecutor,
  NpPriorityLabel,
  NpStatusBadge,
} from '@/components/np-badges';

import { ISSUE_PRIORITIES } from '../constants.js';
import { useNpFormatters } from '../format.js';
import type { IssueListItem } from '../types.js';

/** Column definitions for the issue list. The identifier links to the detail page so rows are keyboard-reachable. */
export function useIssueColumns(): ColumnDef<IssueListItem, unknown>[] {
  const { t } = useTranslation();
  const format = useNpFormatters();
  const { search } = useLocation();

  return useMemo<ColumnDef<IssueListItem, unknown>[]>(
    () => [
      {
        accessorKey: 'identifier',
        enableHiding: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('np.issues.columns.identifier')}
          />
        ),
        sortingFn: (a, b) =>
          (a.original.number ?? 0) - (b.original.number ?? 0) ||
          a.original.identifier.localeCompare(b.original.identifier),
        cell: ({ row }) => (
          <Link
            to={{ pathname: encodeURIComponent(row.original.id), search }}
            onClick={(event) => event.stopPropagation()}
            className='font-mono text-xs text-muted-foreground hover:text-foreground hover:underline'
          >
            {row.original.identifier}
          </Link>
        ),
      },
      {
        accessorKey: 'title',
        enableHiding: false,
        enableSorting: false,
        header: t('np.issues.columns.title'),
        cell: ({ row }) => (
          <div className='min-w-48 space-y-1'>
            <span className='line-clamp-2 font-medium wrap-anywhere'>
              {row.original.title}
            </span>
            {row.original.labels && row.original.labels.length > 0 ? (
              <div className='flex flex-wrap gap-1'>
                {row.original.labels.map((label) => (
                  <NpLabelChip key={label.id} label={label} />
                ))}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'statusKey',
        enableSorting: false,
        header: t('np.issues.columns.status'),
        cell: ({ row }) => <NpStatusBadge statusKey={row.original.statusKey} />,
      },
      {
        accessorKey: 'priority',
        enableHiding: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('np.issues.columns.priority')}
          />
        ),
        sortingFn: (a, b) =>
          ISSUE_PRIORITIES.indexOf(a.original.priority) -
          ISSUE_PRIORITIES.indexOf(b.original.priority),
        cell: ({ row }) => <NpPriorityLabel priority={row.original.priority} />,
      },
      {
        id: 'owner',
        enableSorting: false,
        header: t('np.issues.columns.owner'),
        cell: ({ row }) =>
          row.original.ownerName ? (
            <span className='text-sm'>{row.original.ownerName}</span>
          ) : (
            <span className='text-muted-foreground'>—</span>
          ),
      },
      {
        id: 'executor',
        enableSorting: false,
        header: t('np.issues.columns.executor'),
        cell: ({ row }) => (
          <NpExecutor
            type={row.original.executorType}
            name={row.original.executorName}
            activeRunCount={row.original.activeRunCount}
          />
        ),
      },
      {
        accessorKey: 'updatedAt',
        enableHiding: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('np.issues.columns.updated')}
          />
        ),
        cell: ({ row }) => (
          <span
            className='text-sm whitespace-nowrap text-muted-foreground'
            title={format.dateTime(row.original.updatedAt)}
          >
            {format.relative(row.original.updatedAt)}
          </span>
        ),
      },
    ],
    [t, format, search],
  );
}
