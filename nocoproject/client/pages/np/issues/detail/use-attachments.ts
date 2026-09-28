import { ApiClientError, useService } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMemo } from 'react';

import { clientFileRepositoryManagerToken } from '@/extensions/nocobase-file-component-ui';

import { ATTACHMENT_RESOURCE } from '../../api-attachments.js';

/**
 * Shared by the attachments section and the manual "new issue" form (NP-78): the upload repository, the file
 * components' labels and the upload error wording.
 */

/** The file plugin's client repository for attachment uploads (`npFiles`). */
export function useAttachmentRepository() {
  const manager = useService(clientFileRepositoryManagerToken);
  return useMemo(() => manager.repository(ATTACHMENT_RESOURCE), [manager]);
}

/** The labels the file components take, in the application's wording. */
export function useFileLabels() {
  const { t } = useTranslation();
  return {
    choose: t('np.attachments.choose'),
    preview: t('np.attachments.preview'),
    download: t('np.attachments.download'),
    remove: t('np.attachments.remove'),
    retry: t('np.attachments.retry'),
  };
}

/** An upload error in the application's words (the plugin's codes for size and type). */
export function uploadErrorTitle(
  t: (key: string) => string,
  error: Error,
): string {
  if (error instanceof ApiClientError && error.status === 413)
    return t('np.attachments.tooLarge');
  return t('np.attachments.uploadFailed');
}
