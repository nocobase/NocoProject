import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';

import { RouteDrawer } from '@/components/route-drawer';

import { BatchesList } from './batches-list.js';
import { intakeCloseSearch } from './intake-location.js';
import { IntakeBatchView, IntakeComposer } from './intake-panels.js';

/**
 * Batch entry as a wide route drawer (iteration 3 §G), at `/issues/intake` over the issue list and at
 * `/projects/:projectId/intake` over a project ("批量添加", the project preselected). Paste text, the server parses it
 * into drafts, the drafts open in the editor — the batch id sits in `?batch=` so a reload keeps it — and "Create
 * issues" creates them. Closing drops `batch` / `project` from the query string and returns to the page underneath.
 */
export default function IntakeDrawer(): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const { projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const batchId = params.get('batch');

  function setBatch(id: string | null): void {
    const next = new URLSearchParams(params);
    if (id) next.set('batch', id);
    else next.delete('batch');
    setParams(next);
  }

  return (
    <RouteDrawer
      title={t('np.intake.title')}
      description={t('np.intake.description')}
      className='sm:max-w-5xl'
      closeTo={{ pathname: '..', search: intakeCloseSearch(location.search) }}
    >
      <div className='space-y-6'>
        {batchId ? (
          <IntakeBatchView
            key={batchId}
            batchId={batchId}
            onClose={() => setBatch(null)}
          />
        ) : (
          <IntakeComposer
            initialProjectId={projectId ?? params.get('project')}
            onParsed={(id) => setBatch(id)}
          />
        )}
        <BatchesList onOpen={(id) => setBatch(id)} />
      </div>
    </RouteDrawer>
  );
}
