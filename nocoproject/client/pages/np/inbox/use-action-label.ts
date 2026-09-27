import { useTranslation } from '@nocobase/i18n/client';

import type { InboxDecisionAction } from '../types-iter3.js';

/** The label of an action: the server's i18n key, else ours for its `key`, else the key itself. */
export function useActionLabel(): (action: InboxDecisionAction) => string {
  const { t } = useTranslation();
  return (action) =>
    t(action.label, {
      defaultValue: t(`np.inboxActions.${action.key}`, {
        defaultValue: action.key,
      }),
    });
}
