import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

import {
  playInboxChime,
  useInboxChimePreference,
} from '../inbox/inbox-chime.js';
import { ConfigSectionHeading } from './config-section.js';

/**
 * The viewer's own reminder preferences at the top of 设置 → 通用 (NP-108). Unlike the workspace settings below it,
 * every member may change these and they apply at once: the inbox chime is kept per browser, the same value the
 * speaker button in the inbox header toggles. Turning it on plays the chime once.
 */
export function ChimePreferenceSection(): ReactElement {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useInboxChimePreference();
  return (
    <section
      className='space-y-4'
      aria-labelledby='np-config-reminders-heading'
    >
      <ConfigSectionHeading
        id='np-config-reminders-heading'
        title={t('np.inbox.chime.settingsTitle')}
        description={t('np.inbox.chime.settingsDescription')}
      />
      <FieldGroup className='max-w-2xl'>
        <Field orientation='horizontal'>
          <FieldContent>
            <FieldLabel htmlFor='np-settings-inbox-chime'>
              {t('np.inbox.chime.label')}
            </FieldLabel>
            <FieldDescription>{t('np.inbox.chime.hint')}</FieldDescription>
          </FieldContent>
          <Switch
            id='np-settings-inbox-chime'
            checked={enabled}
            onCheckedChange={(value) => {
              setEnabled(value);
              if (value) playInboxChime({ preview: true });
            }}
          />
        </Field>
      </FieldGroup>
    </section>
  );
}
