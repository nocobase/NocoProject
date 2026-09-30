import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

import { PropertySelect } from '../issues/detail/property-fields.js';
import type {
  AiFeatureEffective,
  AiFeatureKey,
  AiFeatureSetting,
  AiModelOption,
} from '../types.js';

const DEFAULT_MODEL = 'default';
const SEPARATOR = '\u001f';

const encode = (model: AiFeatureSetting['model']): string =>
  model ? `${model.llmService}${SEPARATOR}${model.model}` : DEFAULT_MODEL;

function decode(value: string): AiFeatureSetting['model'] {
  const [llmService, model] = value.split(SEPARATOR);
  return llmService && model ? { llmService, model } : null;
}

/**
 * NP-205: one fast AI feature in the general settings — its switch, its parser (automatic or rules only) and the model
 * it calls — and, read-only, the model it actually uses now (or why it answers with rules). A model chosen earlier
 * and since removed from the LLM services still lists, marked unavailable, so the select never shows a blank.
 */
export function AiFeatureFields({
  feature,
  draft,
  models,
  effective,
  canEdit,
  onChange,
}: {
  readonly feature: AiFeatureKey;
  readonly draft: AiFeatureSetting;
  readonly models: readonly AiModelOption[];
  readonly effective: AiFeatureEffective | undefined;
  readonly canEdit: boolean;
  readonly onChange: (value: AiFeatureSetting) => void;
}): ReactElement {
  const { t } = useTranslation();
  const id = `np-settings-${feature}`;
  const chosen = encode(draft.model);
  const options = [
    { value: DEFAULT_MODEL, label: t('np.settingsPage.ai.defaultModel') },
    ...models.flatMap((service) =>
      service.models.map((model) => ({
        value: encode({ llmService: service.llmService, model: model.value }),
        label: `${service.title} · ${model.label}`,
      })),
    ),
  ];
  if (!options.some((option) => option.value === chosen))
    options.push({
      value: chosen,
      label: t('np.settingsPage.ai.unavailableModel', {
        model: draft.model?.model ?? '',
      }),
    });
  const used = effective?.model
    ? `${effective.model.serviceTitle} · ${effective.model.label}`
    : null;
  return (
    <fieldset className='space-y-4'>
      <legend className='font-heading text-sm font-semibold'>
        {t(`np.settingsPage.ai.${feature}`)}
      </legend>
      <p className='text-sm text-muted-foreground'>
        {t(`np.settingsPage.ai.${feature}Hint`)}
      </p>
      <Field orientation='horizontal'>
        <FieldContent>
          <FieldLabel htmlFor={`${id}-enabled`}>
            {t(`np.settingsPage.ai.${feature}Enabled`)}
          </FieldLabel>
          <FieldDescription>
            {t(`np.settingsPage.ai.${feature}EnabledHint`)}
          </FieldDescription>
        </FieldContent>
        <Switch
          id={`${id}-enabled`}
          checked={draft.enabled}
          disabled={!canEdit}
          onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-parser`}>
          {t('np.settingsPage.ai.parser')}
        </FieldLabel>
        <PropertySelect
          id={`${id}-parser`}
          size='default'
          disabled={!canEdit || !draft.enabled}
          options={[
            { value: 'auto', label: t('np.settingsPage.intakeParserAuto') },
            {
              value: 'heuristic',
              label: t('np.settingsPage.intakeParserHeuristic'),
            },
          ]}
          value={draft.parser}
          onChange={(value) =>
            onChange({
              ...draft,
              parser: value === 'heuristic' ? 'heuristic' : 'auto',
            })
          }
        />
        <FieldDescription>
          {t('np.settingsPage.intakeParserHint')}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-model`}>
          {t('np.settingsPage.ai.model')}
        </FieldLabel>
        <PropertySelect
          id={`${id}-model`}
          size='default'
          disabled={!canEdit || !draft.enabled || draft.parser !== 'auto'}
          options={options}
          value={chosen}
          onChange={(value) =>
            onChange({ ...draft, model: decode(value ?? DEFAULT_MODEL) })
          }
        />
        <FieldDescription>{t('np.settingsPage.ai.modelHint')}</FieldDescription>
      </Field>
      <p className='text-sm' data-testid={`${id}-effective`}>
        {effective?.active && used
          ? t(
              effective.source === 'setting'
                ? 'np.settingsPage.ai.usingModel'
                : 'np.settingsPage.ai.usingDefaultModel',
              { model: used },
            )
          : null}
      </p>
      {effective && effective.fallback && effective.fallback !== 'disabled' ? (
        <Alert>
          <AlertDescription>
            {t(`np.settingsPage.ai.fallback.${effective.fallback}`)}
          </AlertDescription>
        </Alert>
      ) : null}
      {effective?.fallback === 'disabled' ? (
        <Alert>
          <AlertDescription>
            {t(`np.settingsPage.ai.fallback.disabled.${feature}`)}
          </AlertDescription>
        </Alert>
      ) : null}
    </fieldset>
  );
}
