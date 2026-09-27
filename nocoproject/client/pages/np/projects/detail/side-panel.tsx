import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery } from '@tanstack/react-query';
import { PencilIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';

import { NpMarkdown } from '@/components/np-markdown';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

import { fetchWorkflows } from '../../api-collab.js';
import { updateProject } from '../../api-projects.js';
import { ISSUE_PRIORITIES, npKeys } from '../../constants.js';
import {
  DateField,
  PropertyRow,
  PropertySelect,
} from '../../issues/detail/property-fields.js';
import type { Member, ProjectDetail, UpdateProjectInput } from '../../types.js';
import { ProjectProgressBar } from '../project-badges.js';
import {
  PROJECT_STATUSES,
  type ProjectProgress,
  isProjectStatus,
  projectStatusKey,
} from '../progress.js';
import { MembersSection } from './members-section.js';
import { ResourcesSection } from './resources-section.js';
import { useProjectMutation } from './use-project-mutation.js';

function DescriptionBlock({
  description,
  canEdit,
  saving,
  onSave,
}: {
  readonly description: string | null | undefined;
  readonly canEdit: boolean;
  readonly saving: boolean;
  readonly onSave: (value: string | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) {
    return (
      <div className='space-y-2'>
        <Textarea
          rows={5}
          value={draft}
          autoFocus
          aria-label={t('np.projects.descriptionLabel')}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className='flex justify-end gap-2'>
          <Button variant='outline' size='sm' onClick={() => setDraft(null)}>
            {t('actions.cancel')}
          </Button>
          <Button
            size='sm'
            disabled={saving}
            onClick={() => {
              onSave(draft.trim() || null);
              setDraft(null);
            }}
          >
            {t('np.common.save')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className='group space-y-1'>
      {description ? (
        <NpMarkdown content={description} />
      ) : (
        <p className='text-sm text-muted-foreground'>
          {t('np.projects.noDescription')}
        </p>
      )}
      <p className='text-xs text-muted-foreground'>
        {t('np.projectForm.descriptionHint')}
      </p>
      {canEdit ? (
        <Button
          variant='ghost'
          size='xs'
          onClick={() => setDraft(description ?? '')}
        >
          <PencilIcon data-icon='inline-start' />
          {t('np.projects.editDescription')}
        </Button>
      ) : null}
    </div>
  );
}

/** The project's right-hand panel (§J 4): properties, progress, description, repositories and members. */
export function ProjectSidePanel({
  project,
  progress,
  workspaceMembers,
  canEdit,
}: {
  readonly project: ProjectDetail;
  readonly progress: ProjectProgress;
  readonly workspaceMembers: readonly Member[];
  readonly canEdit: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const update = useProjectMutation((changes: UpdateProjectInput) =>
    updateProject(api, project.id, changes),
  );
  const disabled = !canEdit || update.isPending;
  const workflows = useQuery({
    queryKey: npKeys.workflows,
    queryFn: () => fetchWorkflows(api),
  });

  return (
    <div className='space-y-6 p-4 md:p-6'>
      <section
        className='space-y-3'
        aria-labelledby='np-project-properties-heading'
      >
        <h2
          id='np-project-properties-heading'
          className='text-sm font-semibold'
        >
          {t('np.properties.title')}
        </h2>
        <PropertyRow
          label={t('np.projects.columns.status')}
          htmlFor='np-project-status'
        >
          <PropertySelect
            id='np-project-status'
            options={PROJECT_STATUSES.map((status) => ({
              value: status,
              label: t(projectStatusKey(status)),
            }))}
            value={project.status ?? 'planned'}
            disabled={disabled}
            onChange={(value) => {
              if (isProjectStatus(value)) update.mutate({ status: value });
            }}
          />
        </PropertyRow>
        <PropertyRow
          label={t('np.properties.priority')}
          htmlFor='np-project-priority'
        >
          <PropertySelect
            id='np-project-priority'
            options={ISSUE_PRIORITIES.map((value) => ({
              value,
              label: t(`np.priority.${value}`),
            }))}
            value={project.priority ?? 'none'}
            disabled={disabled}
            onChange={(value) => {
              const next = ISSUE_PRIORITIES.find((item) => item === value);
              if (next) update.mutate({ priority: next });
            }}
          />
        </PropertyRow>
        <PropertyRow
          label={t('np.projects.columns.lead')}
          htmlFor='np-project-lead'
        >
          <PropertySelect
            id='np-project-lead'
            options={workspaceMembers.map((member) => ({
              value: member.userId,
              label: member.name,
            }))}
            value={project.leadUserId ?? null}
            noneLabel={t('np.projects.noLead')}
            disabled={disabled}
            onChange={(value) => update.mutate({ leadUserId: value })}
          />
        </PropertyRow>
        <PropertyRow
          label={t('np.projectMore.workflow')}
          htmlFor='np-project-workflow'
        >
          <PropertySelect
            id='np-project-workflow'
            options={(workflows.data ?? []).map((workflow) => ({
              value: workflow.id,
              label: workflow.name,
            }))}
            value={
              project.workflowId ??
              project.workflow?.id ??
              workflows.data?.find((workflow) => workflow.isDefault)?.id ??
              null
            }
            disabled={disabled || !workflows.data}
            onChange={(value) => {
              if (value) update.mutate({ workflowId: value });
            }}
          />
        </PropertyRow>
        <PropertyRow label={t('np.dates.start')} htmlFor='np-project-start'>
          <DateField
            id='np-project-start'
            value={project.startDate}
            disabled={disabled}
            clearLabel={t('np.dates.clearStart')}
            onChange={(value) => update.mutate({ startDate: value })}
          />
        </PropertyRow>
        <PropertyRow label={t('np.dates.due')} htmlFor='np-project-due'>
          <DateField
            id='np-project-due'
            value={project.dueDate}
            disabled={disabled}
            clearLabel={t('np.dates.clearDue')}
            onChange={(value) => update.mutate({ dueDate: value })}
          />
        </PropertyRow>
      </section>

      <section
        className='space-y-2'
        aria-labelledby='np-project-progress-heading'
      >
        <h2 id='np-project-progress-heading' className='text-sm font-semibold'>
          {t('np.projects.columns.progress')}
        </h2>
        <ProjectProgressBar
          {...progress}
          label={t('np.projects.progressLabel', {
            done: progress.done,
            total: progress.total,
          })}
        />
      </section>

      <section
        className='space-y-2'
        aria-labelledby='np-project-description-heading'
      >
        <h2
          id='np-project-description-heading'
          className='text-sm font-semibold'
        >
          {t('np.projects.descriptionLabel')}
        </h2>
        <DescriptionBlock
          description={project.description}
          canEdit={canEdit}
          saving={update.isPending}
          onSave={(value) => update.mutate({ description: value })}
        />
      </section>

      <Separator />
      <ResourcesSection
        projectId={project.id}
        resources={project.resources ?? []}
        canEdit={canEdit}
      />
      <Separator />
      <MembersSection
        projectId={project.id}
        visibility={project.visibility ?? 'everyone'}
        members={project.members ?? []}
        workspaceMembers={workspaceMembers}
        canEdit={canEdit}
      />
    </div>
  );
}
