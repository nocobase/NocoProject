import { useTranslation } from '@nocobase/i18n/client';
import { type ReactElement, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import { RouteDialog } from '@/components/route-dialog';

import { ManualIssueFooter, ManualIssueForm } from './new-manual.js';
import { newIssueCloseSearch } from './new-issue-model.js';

/**
 * Route `/issues/new`: "New issue", the manual single-issue form (`?project=` preselects the project). The line on
 * top of the form hands the request to the project manager instead (`new-manual.tsx`). The old batch-entry links
 * (`/issues/intake`, `/projects/:id/intake`, `/intake`) redirect here. Closing drops the retired `tab` and `batch`
 * parameters and returns to the list underneath.
 */
export default function NewIssuePage(): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const handleSubmittingChange = (value: boolean): void => {
    submittingRef.current = value;
    setSubmitting(value);
  };

  return (
    <RouteDialog
      title={t('np.newIssue.title')}
      className='sm:max-w-xl'
      closeTo={{ pathname: '..', search: newIssueCloseSearch(location.search) }}
      beforeClose={() => !submittingRef.current}
      footer={<ManualIssueFooter submitting={submitting} />}
    >
      <ManualIssueForm onSubmittingChange={handleSubmittingChange} />
    </RouteDialog>
  );
}
