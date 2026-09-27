import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  AlertCircleIcon,
  ListTodoIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';

import { DataTable } from '@/components/data-table';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

import { fetchIssues } from '../api.js';
import {
  DEFAULT_STATUS_CATALOG,
  KNOWN_STATUS_KEYS,
  npKeys,
  statusLabelKey,
} from '../constants.js';
import type { AgentsTopicPayload, IssuesTopicPayload } from '../types.js';
import { useRealtimeTopic } from '../use-realtime.js';
import { useIssueColumns } from './columns.js';

/**
 * Route `/issues`: every issue, newest activity first as the endpoint orders it.
 *
 * Search and the status filter are sent to `GET /np/issues` (`q`, `statusKey`). They live in component state for
 * Phase 0 rather than in the URL. The page stays mounted underneath its child routes (`new` dialog, `:issueId`
 * covering page), so this page owns the `np:issues` subscription for both: it invalidates the list and the detail of
 * the issue that changed.
 */
export default function IssuesPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [statusKey, setStatusKey] = useState<string | undefined>(undefined);
  const searchTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(searchTimerRef.current), []);

  function scheduleSearch(value: string): void {
    window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(
      () => setSearch(value.trim()),
      300,
    );
  }

  const filters = { statusKey, q: search || undefined };
  const query = useQuery({
    queryKey: npKeys.issueList(filters),
    queryFn: ({ signal }) => fetchIssues(api, filters, signal),
    placeholderData: keepPreviousData,
  });

  useRealtimeTopic<IssuesTopicPayload>('np:issues', (payload) => {
    void queryClient.invalidateQueries({ queryKey: npKeys.issues });
    void queryClient.invalidateQueries({
      queryKey: payload?.issueId
        ? npKeys.issue(payload.issueId)
        : ['np', 'issue'],
    });
  });
  useRealtimeTopic<AgentsTopicPayload>('np:agents', () => {
    void queryClient.invalidateQueries({ queryKey: npKeys.agents });
  });

  const columns = useIssueColumns();
  const hasFilters = text.trim() !== '' || statusKey !== undefined;

  function clearFilters(): void {
    window.clearTimeout(searchTimerRef.current);
    setText('');
    setSearch('');
    setStatusKey(undefined);
    searchRef.current?.focus();
  }

  const statusItems = [
    { value: 'all', label: t('np.issues.allStatuses') },
    ...DEFAULT_STATUS_CATALOG.map((entry) => ({
      value: entry.key,
      label: t(statusLabelKey(entry.key)),
    })),
  ];

  const rows = query.data;
  const filteredResult = search !== '' || statusKey !== undefined;

  let content: ReactElement;
  if (query.isError && !query.isFetching) {
    const forbidden =
      query.error instanceof ApiClientError && query.error.status === 403;
    content = (
      <Alert variant='destructive'>
        <AlertCircleIcon />
        <AlertTitle>{t('np.issues.loadFailed')}</AlertTitle>
        <AlertDescription>
          {forbidden ? t('np.common.forbidden') : t('np.common.requestFailed')}
        </AlertDescription>
        {forbidden ? null : (
          <AlertAction>
            <Button
              variant='outline'
              size='sm'
              onClick={() => {
                void query.refetch();
                searchRef.current?.focus();
              }}
            >
              {t('status.retry')}
            </Button>
          </AlertAction>
        )}
      </Alert>
    );
  } else if (!rows) {
    content = (
      <div
        role='status'
        aria-label={t('status.loading')}
        className='space-y-2 rounded-lg border p-4'
      >
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className='h-8 w-full' />
        ))}
      </div>
    );
  } else if (rows.length === 0 && !filteredResult) {
    content = (
      <Empty className='border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <ListTodoIcon />
          </EmptyMedia>
          <EmptyTitle>{t('np.issues.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('np.issues.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant='outline'
            nativeButton={false}
            render={<Link to='new' />}
          >
            <PlusIcon data-icon='inline-start' />
            {t('np.issues.new')}
          </Button>
        </EmptyContent>
      </Empty>
    );
  } else {
    content = (
      <DataTable
        columns={columns}
        data={rows}
        pageSize={20}
        getRowId={(issue) => issue.id}
        onRowClick={(row) => void navigate(encodeURIComponent(row.original.id))}
        emptyMessage={
          <div className='flex flex-col items-center gap-2'>
            <span>{t('np.issues.noResults')}</span>
            <Button variant='outline' size='sm' onClick={clearFilters}>
              {t('np.common.clearFilters')}
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('np.issues.title')}
        description={t('np.issues.description')}
        actions={
          <Button nativeButton={false} render={<Link to='new' />}>
            <PlusIcon data-icon='inline-start' />
            {t('np.issues.new')}
          </Button>
        }
      />

      <div className='space-y-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <InputGroup className='w-full sm:w-72'>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchRef}
              value={text}
              placeholder={t('np.issues.searchPlaceholder')}
              aria-label={t('np.issues.searchLabel')}
              onChange={(event) => {
                setText(event.target.value);
                if (!(event.nativeEvent as InputEvent).isComposing) {
                  scheduleSearch(event.target.value);
                }
              }}
              onCompositionEnd={(event) =>
                scheduleSearch(event.currentTarget.value)
              }
            />
          </InputGroup>
          <Select
            items={statusItems}
            value={statusKey ?? 'all'}
            onValueChange={(value) =>
              setStatusKey(
                value && value !== 'all' && KNOWN_STATUS_KEYS.has(value)
                  ? value
                  : undefined,
              )
            }
          >
            <SelectTrigger
              className='w-44'
              aria-label={t('np.issues.statusFilterLabel')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters ? (
            <Button variant='ghost' size='sm' onClick={clearFilters}>
              <XIcon data-icon='inline-start' />
              {t('np.common.clearFilters')}
            </Button>
          ) : null}
          {query.isFetching && rows ? (
            <Spinner
              className='size-4 text-muted-foreground'
              aria-label={t('status.loading')}
            />
          ) : null}
        </div>
        {content}
      </div>

      <Outlet />
    </PageContainer>
  );
}
