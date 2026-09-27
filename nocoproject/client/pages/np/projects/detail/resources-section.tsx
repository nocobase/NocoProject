import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { GitBranchIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';

import { removeProjectResource } from '../../api-projects.js';
import type { ProjectResource } from '../../types.js';
import { useProjectMutation } from './use-project-mutation.js';

/**
 * Repositories the project's agents may check out (§F, §I). Adding opens the `resources/new` route dialog; only the
 * project lead and owner/admin see the add and remove controls.
 */
export function ResourcesSection({
  projectId,
  resources,
  canEdit,
}: {
  readonly projectId: string;
  readonly resources: readonly ProjectResource[];
  readonly canEdit: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const remove = useProjectMutation(
    (resourceId: string) => removeProjectResource(api, projectId, resourceId),
    t('np.resources.removed'),
  );
  const sorted = [...resources].sort((a, b) => a.position - b.position);

  return (
    <section className='space-y-3' aria-labelledby='np-resources-heading'>
      <div className='flex items-center justify-between gap-2'>
        <h2 id='np-resources-heading' className='text-sm font-semibold'>
          {t('np.resources.title')}
        </h2>
        {canEdit ? (
          <Button
            variant='ghost'
            size='xs'
            nativeButton={false}
            render={<Link to='resources/new' />}
          >
            <PlusIcon data-icon='inline-start' />
            {t('np.resources.add')}
          </Button>
        ) : null}
      </div>
      {sorted.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {t('np.resources.empty')}
        </p>
      ) : (
        <ul className='space-y-2'>
          {sorted.map((resource) => (
            <li key={resource.id} className='flex items-start gap-2 text-sm'>
              <GitBranchIcon
                className='mt-0.5 size-4 shrink-0 text-muted-foreground'
                aria-hidden='true'
              />
              <div className='min-w-0 flex-1'>
                <p className='truncate font-medium'>
                  {resource.label || resource.url}
                </p>
                <p className='truncate text-xs text-muted-foreground'>
                  {resource.label ? `${resource.url} · ` : ''}
                  {resource.defaultRef ?? t('np.resources.defaultBranch')}
                </p>
              </div>
              {canEdit ? (
                <Button
                  variant='ghost'
                  size='icon-xs'
                  disabled={remove.isPending}
                  aria-label={t('np.resources.remove', {
                    name: resource.label || resource.url,
                  })}
                  onClick={() => remove.mutate(resource.id)}
                >
                  <Trash2Icon />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
