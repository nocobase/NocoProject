import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { AlertCircleIcon, ListTodoIcon, PlusIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';

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
import { Skeleton } from '@/components/ui/skeleton';

import { fetchLabels, fetchMembers, fetchWorkflows } from '../api-collab.js';
import { fetchAgents, fetchBoard, fetchIssues, fetchProjects } from '../api.js';
import {
  DEFAULT_STATUS_CATALOG,
  KNOWN_STATUS_KEYS,
  catalogFromWorkflow,
  npKeys,
  statusLabelKey,
} from '../constants.js';
import type { AgentsTopicPayload, IssuesTopicPayload } from '../types.js';
import { useRealtimeTopic } from '../use-realtime.js';
import { IssueBoard } from './board/board.js';
import { useIssueColumns } from './columns.js';
import {
  hasIssueFilters,
  readIssueFilters,
  readIssueView,
  withIssueFilter,
  withIssueView,
  withoutIssueFilters,
} from './filters.js';
import { IssueToolbar, type IssueToolbarFilter } from './toolbar.js';
import { useUrlSearch } from './use-url-search.js';

/**
 * Route `/issues`: every issue as a list or a board (`?view=board`, §J 1). The view, the search term and the
 * filters live in the query string (§J 7); requests follow the URL. The board's columns are the statuses of the
 * filtered project's workflow, or the default workflow.
 *
 * The page stays mounted underneath its child routes (`new` dialog, `:issueId` covering page), so this page owns the
 * `np:issues` subscription for both: it invalidates the list and the detail of the issue that changed.
 */
export default function IssuesPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const {
    params,
    text,
    setText,
    scheduleSearch,
    updateParams,
    resetText,
    searchRef,
  } = useUrlSearch();

  const view = readIssueView(params);
  const filters = readIssueFilters(params, KNOWN_STATUS_KEYS);

  const list = useQuery({
    queryKey: npKeys.issueList(filters),
    queryFn: ({ signal }) => fetchIssues(api, filters, signal),
    placeholderData: keepPreviousData,
    enabled: view === 'list',
  });
  const board = useQuery({
    queryKey: npKeys.board(filters),
    queryFn: ({ signal }) => fetchBoard(api, filters, signal),
    placeholderData: keepPreviousData,
    enabled: view === 'board',
  });
  const projects = useQuery({
    queryKey: npKeys.projects,
    queryFn: () => fetchProjects(api),
  });
  const labels = useQuery({
    queryKey: npKeys.labels,
    queryFn: () => fetchLabels(api),
  });
  const members = useQuery({
    queryKey: npKeys.members,
    queryFn: () => fetchMembers(api),
  });
  const agents = useQuery({
    queryKey: npKeys.agents,
    queryFn: () => fetchAgents(api),
  });
  const workflows = useQuery({
    queryKey: npKeys.workflows,
    queryFn: () => fetchWorkflows(api),
    enabled: view === 'board',
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
  const filtered = hasIssueFilters(filters);
  const hasFilters = filtered || text.trim() !== '';

  function clearFilters(): void {
    resetText();
    updateParams(withoutIssueFilters);
    searchRef.current?.focus();
  }

  // The filtered project's workflow when it names one, else the default workflow (§C).
  const project = projects.data?.find(
    (candidate) => candidate.id === filters.projectId,
  );
  const workflow =
    workflows.data?.find((candidate) => candidate.id === project?.workflowId) ??
    workflows.data?.find((candidate) => candidate.isDefault) ??
    workflows.data?.[0];
  const catalog = workflows.data
    ? catalogFromWorkflow(workflow)
    : DEFAULT_STATUS_CATALOG;

  const toolbarFilters: IssueToolbarFilter[] = [
    ...(view === 'list'
      ? [
          {
            key: 'statusKey' as const,
            label: t('np.issues.statusFilterLabel'),
            allLabel: t('np.issues.allStatuses'),
            options: DEFAULT_STATUS_CATALOG.map((entry) => ({
              value: entry.key,
              label: t(statusLabelKey(entry.key)),
            })),
            value: filters.statusKey,
          },
        ]
      : []),
    {
      key: 'projectId',
      label: t('np.filters.project'),
      allLabel: t('np.filters.allProjects'),
      options: (projects.data ?? []).map((item) => ({
        value: item.id,
        label: item.name,
      })),
      value: filters.projectId,
    },
    {
      key: 'labelId',
      label: t('np.filters.label'),
      allLabel: t('np.filters.allLabels'),
      options: (labels.data ?? []).map((item) => ({
        value: item.id,
        label: item.name,
      })),
      value: filters.labelId,
    },
    {
      key: 'ownerUserId',
      label: t('np.filters.owner'),
      allLabel: t('np.filters.anyOwner'),
      options: (members.data ?? []).map((item) => ({
        value: item.userId,
        label: item.name,
      })),
      value: filters.ownerUserId,
    },
    {
      key: 'executorId',
      label: t('np.filters.executor'),
      allLabel: t('np.filters.anyExecutor'),
      options: [
        ...(agents.data ?? []).map((item) => ({
          value: item.id,
          label: item.name,
        })),
        ...(members.data ?? []).map((item) => ({
          value: item.userId,
          label: item.name,
        })),
      ],
      value: filters.executorId,
    },
  ];

  const active = view === 'board' ? board : list;
  const newLink = { pathname: 'new', search: location.search };

  let content: ReactElement;
  if (active.isError && !active.isFetching) {
    const forbidden =
      active.error instanceof ApiClientError && active.error.status === 403;
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
                void active.refetch();
                searchRef.current?.focus();
              }}
            >
              {t('status.retry')}
            </Button>
          </AlertAction>
        )}
      </Alert>
    );
  } else if (!active.data) {
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
  } else if (view === 'board' && board.data) {
    content = <IssueBoard groups={board.data} catalog={catalog} />;
  } else if (list.data && list.data.length === 0 && !filtered) {
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
            render={<Link to={newLink} />}
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
        data={list.data ?? []}
        pageSize={20}
        showSelectedCount={false}
        getRowId={(issue) => issue.id}
        onRowClick={(row) =>
          void navigate({
            pathname: encodeURIComponent(row.original.id),
            search: location.search,
          })
        }
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
          <Button nativeButton={false} render={<Link to={newLink} />}>
            <PlusIcon data-icon='inline-start' />
            {t('np.issues.new')}
          </Button>
        }
      />

      <div className='space-y-4'>
        <IssueToolbar
          searchRef={searchRef}
          searchText={text}
          onSearchTextChange={setText}
          onSearchSettled={scheduleSearch}
          filters={toolbarFilters}
          view={view}
          hasFilters={hasFilters}
          fetching={active.isFetching && active.data !== undefined}
          onFilterChange={(key, value) =>
            updateParams((current) => withIssueFilter(current, key, value))
          }
          onViewChange={(next) =>
            updateParams((current) => withIssueView(current, next))
          }
          onClear={clearFilters}
        />
        {content}
      </div>

      <Outlet />
    </PageContainer>
  );
}
