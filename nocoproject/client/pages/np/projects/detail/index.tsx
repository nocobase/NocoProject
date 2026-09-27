import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircleIcon,
  ListPlusIcon,
  LockIcon,
  PlusIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { Link, Outlet, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { RouteChildPage } from '@/components/route-child-page';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { NpDetailLayout } from '@/components/np-detail-layout';
import { NpDetailSkeleton } from '@/components/np-states';
import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';

import { fetchMembers } from '../../api-collab.js';
import { fetchProject } from '../../api-projects.js';
import { fetchMe } from '../../api.js';
import { catalogFromWorkflow, npKeys } from '../../constants.js';
import { type BoardColumnMore, IssueBoard } from '../../issues/board/board.js';
import { useBoardPages } from '../../issues/use-issue-pages.js';
import {
  canDeleteProject,
  canEditProject,
  viewerFrom,
} from '../../permissions.js';
import type { BoardGroup, Member, ProjectDetail } from '../../types.js';
import { ProjectStatusBadge } from '../project-badges.js';
import { progressFromCounts, progressFromGroups } from '../progress.js';
import { ProjectActions } from './project-actions.js';
import { ProjectSidePanel } from './side-panel.js';

/**
 * Route `/projects/:projectId` (§J 4): a covering child page over the project list. The project's issues fill a
 * board whose columns are its workflow's statuses (drag to change status, as on `/issues?view=board`); the
 * right-hand panel (fixed `w-80`, §H 3) holds status, priority, lead, dates, progress, description, repositories and
 * members. The `resources/new` dialog and the batch entry drawer (`intake`, the project preselected) render in the
 * outlet beside the layer.
 */
export default function ProjectDetailPage(): ReactElement {
  const { projectId = '' } = useParams();
  return (
    <>
      <RouteChildPage>
        <ProjectDetailView key={projectId} projectId={projectId} />
      </RouteChildPage>
      <Outlet />
    </>
  );
}

function ProjectDetailView({
  projectId,
}: {
  readonly projectId: string;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const project = useQuery({
    queryKey: npKeys.project(projectId),
    queryFn: ({ signal }) => fetchProject(api, projectId, signal),
    retry: (count, error) =>
      !(error instanceof ApiClientError && [403, 404].includes(error.status)) &&
      count < 2,
  });
  const filters = { projectId };
  const board = useBoardPages(filters, true);
  const me = useQuery({ queryKey: npKeys.me, queryFn: () => fetchMe(api) });
  const members = useQuery({
    queryKey: npKeys.members,
    queryFn: () => fetchMembers(api),
  });

  if (project.isError && !project.data) {
    const status =
      project.error instanceof ApiClientError
        ? project.error.status
        : undefined;
    return (
      <div className='space-y-4 p-6 md:p-8'>
        <Breadcrumbs />
        <Alert variant='destructive'>
          <AlertCircleIcon />
          <AlertTitle>{t('np.projects.detailLoadFailed')}</AlertTitle>
          <AlertDescription>
            {status === 404
              ? t('np.projects.notFound')
              : status === 403
                ? t('np.common.forbidden')
                : t('np.common.requestFailed')}
          </AlertDescription>
          <AlertAction>
            {status === 404 || status === 403 ? (
              <Button
                variant='outline'
                size='sm'
                nativeButton={false}
                render={<Link to='..' relative='path' />}
              >
                {t('np.projects.backToList')}
              </Button>
            ) : (
              <Button
                variant='outline'
                size='sm'
                onClick={() => void project.refetch()}
              >
                {t('status.retry')}
              </Button>
            )}
          </AlertAction>
        </Alert>
      </div>
    );
  }

  if (!project.data) return <NpDetailSkeleton />;

  const viewer = viewerFrom(me.data?.userId, members.data);
  return (
    <ProjectLayout
      project={project.data}
      groups={board.groups}
      columnMore={board.more}
      workspaceMembers={members.data ?? []}
      canEdit={canEditProject(viewer, project.data)}
      canDelete={canDeleteProject(viewer)}
    />
  );
}

function ProjectLayout({
  project,
  groups,
  columnMore,
  workspaceMembers,
  canEdit,
  canDelete,
}: {
  readonly project: ProjectDetail;
  readonly groups: readonly BoardGroup[] | undefined;
  readonly columnMore: Readonly<Record<string, BoardColumnMore>>;
  readonly workspaceMembers: readonly Member[];
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const catalog = catalogFromWorkflow(project.workflow);
  const progress = project.issueCounts
    ? progressFromCounts(project.issueCounts)
    : progressFromGroups(groups ?? [], catalog);

  const main = (
    <div className='space-y-6 p-6 md:p-8'>
      <Breadcrumbs />
      <PageHeader
        title={
          <span className='inline-flex min-w-0 items-center gap-2'>
            <span className='truncate'>{project.name}</span>
            {project.visibility === 'members' ? (
              <LockIcon
                className='size-4 shrink-0 text-muted-foreground'
                aria-label={t('np.projects.visibility.members')}
              />
            ) : null}
            <ProjectStatusBadge status={project.status} />
          </span>
        }
        description={project.description ?? undefined}
        actions={
          <>
            <Button
              variant='outline'
              nativeButton={false}
              render={<Link to='intake' />}
            >
              <ListPlusIcon data-icon='inline-start' />
              {t('np.projectMore.batchAdd')}
            </Button>
            <Button
              nativeButton={false}
              render={
                <Link
                  to={{
                    pathname: '/issues/new',
                    search: `?project=${encodeURIComponent(project.id)}`,
                  }}
                />
              }
            >
              <PlusIcon data-icon='inline-start' />
              {t('np.issues.new')}
            </Button>
            <ProjectActions project={project} canDelete={canDelete} />
          </>
        }
      />
      {groups ? (
        <IssueBoard
          groups={groups}
          columnMore={columnMore}
          catalog={catalog}
          issueLink={(issue) => `/issues/${encodeURIComponent(issue.id)}`}
        />
      ) : (
        <div
          role='status'
          aria-label={t('status.loading')}
          className='flex gap-3'
        >
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className='h-64 w-72 shrink-0 rounded-lg' />
          ))}
        </div>
      )}
    </div>
  );
  const panel = (
    <ProjectSidePanel
      project={project}
      progress={progress}
      workspaceMembers={workspaceMembers}
      canEdit={canEdit}
    />
  );

  return (
    <NpDetailLayout
      main={main}
      aside={panel}
      asideLabel={t('np.projects.sidePanel')}
    />
  );
}
