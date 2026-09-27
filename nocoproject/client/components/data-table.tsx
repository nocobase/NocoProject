import { useTranslation } from '@nocobase/i18n/client';
import {
  type ColumnDef,
  type ColumnFiltersState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table as TableInstance,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { type ReactElement, type ReactNode, useState } from 'react';

import { DataTablePagination } from '@/components/data-table-pagination';
import { DataTableVirtual } from '@/components/data-table-virtual';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface DataTableProps<TData, TValue = unknown> {
  readonly columns: ColumnDef<TData, TValue>[];
  readonly data: TData[];
  readonly className?: string;
  /**
   * Rendered above the table and handed the table instance, so filters and
   * `DataTableViewOptions` can read and drive its state.
   */
  readonly toolbar?: (table: TableInstance<TData>) => ReactNode;
  /** Shown in place of the body when no row survives filtering. */
  readonly emptyMessage?: ReactNode;
  /** Set to `false` to render every row and hide the pagination footer. */
  readonly pagination?: boolean;
  readonly pageSize?: number;
  readonly pageSizeOptions?: readonly number[];
  /** Set to `false` to hide the "n of m row(s) selected" summary, for tables without row selection. */
  readonly showSelectedCount?: boolean;
  readonly getRowId?: (
    row: TData,
    index: number,
    parent?: Row<TData>,
  ) => string;
  readonly onRowClick?: (row: Row<TData>) => void;
  /**
   * With `pagination={false}`, past this many rows the body is virtualized (`react-virtuoso`), rendering only the
   * rows on screen. NocoProject's issue list sets 200 (§H 8).
   */
  readonly virtualizeAfter?: number;
}

/**
 * A table driven by TanStack Table with client-side sorting, filtering, column
 * visibility, row selection and pagination, composed from the shadcn `Table`
 * primitive the way the shadcn Data Table guide describes.
 *
 * Column definitions decide what each feature does: sort through
 * `DataTableColumnHeader`, filter from the `toolbar` with
 * `table.getColumn(id)?.setFilterValue(...)`, and select rows with a display
 * column that renders a `Checkbox`.
 */
export function DataTable<TData, TValue = unknown>({
  columns,
  data,
  className,
  toolbar,
  emptyMessage,
  pagination = true,
  pageSize = 10,
  pageSizeOptions,
  showSelectedCount = true,
  getRowId,
  onRowClick,
  virtualizeAfter,
}: DataTableProps<TData, TValue>): ReactElement {
  const { t } = useTranslation();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // TanStack Table hands back one mutable instance that the React Compiler
  // cannot memoize, so it skips compiling this component; the table is still
  // correct without it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting, columnFilters, columnVisibility, rowSelection },
    initialState: { pagination: { pageSize } },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(pagination ? { getPaginationRowModel: getPaginationRowModel() } : {}),
  });

  const rows = table.getRowModel().rows;
  const virtualized =
    !pagination &&
    virtualizeAfter !== undefined &&
    rows.length > virtualizeAfter;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {toolbar ? (
        <div className='flex items-center gap-2'>{toolbar(table)}</div>
      ) : null}
      {virtualized ? (
        <div className='rounded-lg border'>
          <DataTableVirtual table={table} onRowClick={onRowClick} />
        </div>
      ) : (
        <div className='overflow-hidden rounded-lg border'>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.length > 0 ? (
                rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? 'selected' : undefined}
                    className={onRowClick ? 'cursor-pointer' : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className='h-24 text-center text-muted-foreground'
                  >
                    {emptyMessage ??
                      t('dataTable.noResults', { defaultValue: 'No results.' })}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {pagination ? (
        <DataTablePagination
          table={table}
          pageSizeOptions={pageSizeOptions}
          showSelectedCount={showSelectedCount}
        />
      ) : null}
    </div>
  );
}
