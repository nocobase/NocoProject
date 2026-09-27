import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircleIcon, PlusIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import { type ReactElement, useState } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

import { fetchWorkflows } from '../api-collab.js';
import {
  fetchWorkspaceSettings,
  updateWorkspaceSettings,
} from '../api-iter2.js';
import {
  DEFAULT_STATUS_CATALOG,
  npKeys,
  statusLabelKey,
} from '../constants.js';
import { PropertySelect } from '../issues/detail/property-fields.js';
import type { IntakeParserSetting, WorkspaceSettings } from '../types.js';
import {
  PRICE_FIELDS,
  type PriceDraft,
  priceDraft,
  priceProblems,
  pricesFromDrafts,
} from './model-prices.js';

/**
 * Settings → NocoProject (iteration 2 §I, owner/admin): the status a merged PR moves its issue to, whether new issues
 * let agents run the sub-issues they create, how batch entry parses text, and the model prices usage costs are
 * estimated from.
 */
export default function NocoProjectSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const settings = useQuery({
    queryKey: npKeys.settings,
    queryFn: () => fetchWorkspaceSettings(api),
    retry: (count, error) =>
      !(error instanceof ApiClientError && error.status === 403) && count < 2,
  });

  let content: ReactElement;
  if (settings.isError && !settings.data) {
    content = (
      <Alert variant='destructive'>
        <AlertCircleIcon />
        <AlertTitle>{t('np.settingsPage.loadFailed')}</AlertTitle>
        <AlertDescription>{t('np.common.requestFailed')}</AlertDescription>
      </Alert>
    );
  } else if (!settings.data) {
    content = <Skeleton className='h-64 w-full max-w-3xl' />;
  } else {
    content = (
      <SettingsForm
        key={JSON.stringify(settings.data)}
        settings={settings.data}
      />
    );
  }
  return (
    <PageContainer>
      <PageHeader
        title={t('np.settingsPage.title')}
        description={t('np.settingsPage.description')}
      />
      {content}
    </PageContainer>
  );
}

function SettingsForm({
  settings,
}: {
  readonly settings: WorkspaceSettings;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const workflows = useQuery({
    queryKey: npKeys.workflows,
    queryFn: () => fetchWorkflows(api),
  });
  const [prMergedStatus, setPrMergedStatus] = useState(
    settings.prMergedStatus ?? 'none',
  );
  const [autoExecute, setAutoExecute] = useState(
    settings.autoExecuteSubtasksDefault ?? false,
  );
  const [intakeParser, setIntakeParser] = useState<IntakeParserSetting>(
    settings.intakeParser ?? 'auto',
  );
  const [prices, setPrices] = useState<PriceDraft[]>(() =>
    (settings.modelPrices ?? []).map(priceDraft),
  );
  const modelPrices = pricesFromDrafts(prices);
  const canEdit = settings.canEdit ?? true;

  const defaultWorkflow =
    workflows.data?.find((workflow) => workflow.isDefault) ??
    workflows.data?.[0];
  const statusKeys =
    defaultWorkflow?.definition.statuses.map((status) => status.key) ??
    DEFAULT_STATUS_CATALOG.map((entry) => entry.key);

  const save = useMutation({
    mutationFn: () =>
      updateWorkspaceSettings(api, {
        prMergedStatus,
        autoExecuteSubtasksDefault: autoExecute,
        intakeParser,
        modelPrices: modelPrices ?? [],
      }),
    onSuccess: () => {
      toast.add({ type: 'success', title: t('np.settingsPage.saved') });
      void queryClient.invalidateQueries({ queryKey: npKeys.settings });
    },
    onError: (error: unknown) =>
      toast.add({
        type: 'error',
        priority: 'high',
        title:
          error instanceof ApiClientError && error.status === 403
            ? t('np.common.forbidden')
            : t('np.common.requestFailed'),
      }),
  });

  function changePrice(index: number, changes: Partial<PriceDraft>): void {
    setPrices((current) =>
      current.map((row, at) => (at === index ? { ...row, ...changes } : row)),
    );
  }

  return (
    <FieldGroup className='max-w-4xl'>
      {canEdit ? null : (
        <p className='text-sm text-muted-foreground'>
          {t('np.settingsPage.readOnly')}
        </p>
      )}
      <Field className='max-w-sm'>
        <FieldLabel htmlFor='np-settings-pr-status'>
          {t('np.settingsPage.prMergedStatus')}
        </FieldLabel>
        <PropertySelect
          id='np-settings-pr-status'
          size='default'
          options={[
            { value: 'none', label: t('np.settingsPage.prMergedNone') },
            ...statusKeys.map((key) => ({
              value: key,
              label: t(statusLabelKey(key), { defaultValue: key }),
            })),
          ]}
          value={prMergedStatus}
          onChange={(value) => setPrMergedStatus(value ?? 'none')}
        />
        <FieldDescription>
          {t('np.settingsPage.prMergedStatusHint')}
        </FieldDescription>
      </Field>
      <Field orientation='horizontal' className='max-w-xl'>
        <FieldContent>
          <FieldLabel htmlFor='np-settings-auto-execute'>
            {t('np.settingsPage.autoExecute')}
          </FieldLabel>
          <FieldDescription>
            {t('np.settingsPage.autoExecuteHint')}
          </FieldDescription>
        </FieldContent>
        <Switch
          id='np-settings-auto-execute'
          checked={autoExecute}
          onCheckedChange={setAutoExecute}
        />
      </Field>
      <Field className='max-w-sm'>
        <FieldLabel htmlFor='np-settings-intake-parser'>
          {t('np.settingsPage.intakeParser')}
        </FieldLabel>
        <PropertySelect
          id='np-settings-intake-parser'
          size='default'
          options={[
            { value: 'auto', label: t('np.settingsPage.intakeParserAuto') },
            {
              value: 'heuristic',
              label: t('np.settingsPage.intakeParserHeuristic'),
            },
          ]}
          value={intakeParser}
          onChange={(value) =>
            setIntakeParser(value === 'heuristic' ? 'heuristic' : 'auto')
          }
        />
        <FieldDescription>
          {t('np.settingsPage.intakeParserHint')}
        </FieldDescription>
      </Field>
      <section
        className='space-y-2'
        aria-labelledby='np-settings-prices-heading'
      >
        <div className='flex items-center justify-between gap-2'>
          <div>
            <h2
              id='np-settings-prices-heading'
              className='text-sm font-semibold'
            >
              {t('np.settingsPage.modelPrices')}
            </h2>
            <p className='text-sm text-muted-foreground'>
              {t('np.settingsPage.modelPricesHint')}
            </p>
          </div>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setPrices((current) => [...current, priceDraft()])}
          >
            <PlusIcon data-icon='inline-start' />
            {t('np.settingsPage.addPrice')}
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {t('np.settingsPage.priceColumns.provider')}
              </TableHead>
              <TableHead>{t('np.settingsPage.priceColumns.model')}</TableHead>
              {PRICE_FIELDS.map((field) => (
                <TableHead key={field} className='text-right'>
                  {t(`np.settingsPage.priceColumns.${field}`)}
                </TableHead>
              ))}
              <TableHead>
                <span className='sr-only'>
                  {t('np.intake.columns.actions')}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prices.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className='h-16 text-center text-muted-foreground'
                >
                  {t('np.settingsPage.noPrices')}
                </TableCell>
              </TableRow>
            ) : (
              prices.map((row, index) => {
                const problems = priceProblems(row);
                return (
                  <TableRow
                    key={row.key}
                    data-invalid={problems.length > 0 ? true : undefined}
                  >
                    <TableCell className='min-w-28'>
                      <Input
                        value={row.provider}
                        placeholder='anthropic'
                        aria-label={t('np.settingsPage.priceColumns.provider')}
                        className='h-8'
                        onChange={(event) =>
                          changePrice(index, { provider: event.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell className='min-w-36'>
                      <Input
                        value={row.model}
                        placeholder='claude-*'
                        aria-label={t('np.settingsPage.priceColumns.model')}
                        aria-invalid={
                          problems.includes('modelRequired') ? true : undefined
                        }
                        className='h-8 font-mono text-xs'
                        onChange={(event) =>
                          changePrice(index, { model: event.target.value })
                        }
                      />
                    </TableCell>
                    {PRICE_FIELDS.map((field) => (
                      <TableCell key={field} className='min-w-24'>
                        <Input
                          value={row[field]}
                          inputMode='decimal'
                          aria-label={t(
                            `np.settingsPage.priceColumns.${field}`,
                          )}
                          aria-invalid={
                            problems.includes('invalidNumber')
                              ? true
                              : undefined
                          }
                          className='h-8 text-right tabular-nums'
                          onChange={(event) =>
                            changePrice(index, { [field]: event.target.value })
                          }
                        />
                      </TableCell>
                    ))}
                    <TableCell>
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        aria-label={t('np.settingsPage.removePrice', {
                          model: row.model || '—',
                        })}
                        onClick={() =>
                          setPrices((current) =>
                            current.filter((_, at) => at !== index),
                          )
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {modelPrices === null ? (
          <p className='text-xs text-destructive'>
            {t('np.settingsPage.pricesInvalid')}
          </p>
        ) : null}
      </section>
      <div className='flex justify-end'>
        <Button
          disabled={!canEdit || save.isPending || modelPrices === null}
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            <Spinner data-icon='inline-start' />
          ) : (
            <SaveIcon data-icon='inline-start' />
          )}
          {t('actions.save')}
        </Button>
      </div>
    </FieldGroup>
  );
}
