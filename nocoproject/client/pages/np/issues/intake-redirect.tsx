import type { ReactElement } from 'react';
import { Navigate, useLocation, useParams } from 'react-router';

import { newIssueRedirectTarget } from './new-issue-model.js';

/**
 * Routes `/intake`, `/issues/intake` and `/projects/:projectId/intake`: batch entry is retired (NP-186), so old links
 * and "Batch add" bookmarks open the manual "New issue" form with the project preselected.
 */
export default function IntakeRedirect(): ReactElement {
  const location = useLocation();
  const { projectId } = useParams();
  return (
    <Navigate replace to={newIssueRedirectTarget(location.search, projectId)} />
  );
}
