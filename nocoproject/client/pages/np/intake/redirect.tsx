import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router';

import { intakeRedirectTarget } from './intake-location.js';

/** Route `/intake`: iteration 2's batch entry page, now the drawer over the issues or the project page (§G). */
export default function IntakeRedirect(): ReactElement {
  const location = useLocation();
  return <Navigate replace to={intakeRedirectTarget(location.search)} />;
}
