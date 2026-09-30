import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';

import { fetchWorkspaceSettings } from './api-iter2.js';
import { npKeys } from './constants.js';

/**
 * NP-205: whether the two fast AI features are switched on in the workspace settings (`intakeAi`: the AI draft tab of
 * the new issue dialog; `breakdownAi`: the sub-issue section's AI breakdown). Both read as on until the settings
 * arrive or when they cannot be read, so a slow or failed request never hides an entry that works.
 */
export function useAiFeatures(): {
  readonly intake: boolean;
  readonly breakdown: boolean;
} {
  const api = useApiClient();
  const settings = useQuery({
    queryKey: npKeys.settings,
    queryFn: () => fetchWorkspaceSettings(api),
    retry: (count, error) =>
      !(error instanceof ApiClientError && error.status === 403) && count < 2,
  });
  return {
    intake: settings.data?.intakeAi?.enabled ?? true,
    breakdown: settings.data?.breakdownAi?.enabled ?? true,
  };
}
