import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircleIcon, WandSparklesIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

import { createIntakeBatch, fetchIntakeBatch } from '../api-intake.js';
import { fetchProjects } from '../api.js';
import { npKeys } from '../constants.js';
import { PropertySelect } from '../issues/detail/property-fields.js';
import { BatchEditor } from './batch-editor.js';
import { BatchesList } from './batches-list.js';

/**
 * Route `/intake` (iteration 2 §E, "批量录入"): paste a list, notes or a CSV, choose a project, and the server parses
 * it into draft issues (with an LLM when one is configured, otherwise by rules). The drafts open in an editable table
 * — the batch id lives in `?batch=` so a reload keeps it — and "Create issues" creates them parents first. `?project=`
 * preselects the project (the project page's "批量添加"); an issue's "AI breakdown" opens its batch here directly.
 */
export default function IntakePage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const batchId = params.get('batch');

  function setBatch(id: string | null): void {
    const next = new URLSearchParams(params);
    if (id) next.set('batch', id);
    else next.delete('batch');
    setParams(next);
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('np.intake.title')}
        description={t('np.intake.description')}
      />
      {batchId ? (
        <BatchView
          key={batchId}
          batchId={batchId}
          onClose={() => setBatch(null)}
        />
      ) : (
        <Composer
          initialProjectId={params.get('project')}
          onParsed={(id) => setBatch(id)}
        />
      )}
      <BatchesList onOpen={(id) => setBatch(id)} />
    </PageContainer>
  );
}

function Composer({
  initialProjectId,
  onParsed,
}: {
  readonly initialProjectId: string | null;
  readonly onParsed: (batchId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [rawContent, setRawContent] = useState('');
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [error, setError] = useState<string>();
  const projects = useQuery({
    queryKey: npKeys.projects,
    queryFn: () => fetchProjects(api),
  });
  const parse = useMutation({
    mutationFn: () =>
      createIntakeBatch(api, {
        source: 'paste',
        rawContent,
        projectId: projectId ?? undefined,
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(npKeys.intakeBatch(detail.batch.id), detail);
      void queryClient.invalidateQueries({ queryKey: npKeys.intakeBatches });
      onParsed(detail.batch.id);
    },
    onError: (failure) =>
      setError(
        failure instanceof ApiClientError && failure.status === 403
          ? t('np.common.forbidden')
          : t('np.intake.parseFailed'),
      ),
  });

  return (
    <section className='space-y-4 rounded-lg border bg-card p-4 text-card-foreground'>
      {error ? (
        <Alert variant='destructive'>
          <AlertCircleIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Field className='max-w-sm'>
        <FieldLabel htmlFor='np-intake-project'>
          {t('np.issueForm.projectLabel')}
        </FieldLabel>
        <PropertySelect
          id='np-intake-project'
          size='default'
          options={(projects.data ?? []).map((project) => ({
            value: project.id,
            label: project.name,
          }))}
          value={projectId}
          noneLabel={t('np.issueForm.noProject')}
          onChange={setProjectId}
        />
      </Field>
      <Field data-invalid={parse.isError ? true : undefined}>
        <FieldLabel htmlFor='np-intake-raw'>
          {t('np.intake.rawLabel')}
        </FieldLabel>
        <Textarea
          id='np-intake-raw'
          value={rawContent}
          rows={10}
          className='font-mono text-sm'
          placeholder={t('np.intake.rawPlaceholder')}
          onChange={(event) => setRawContent(event.target.value)}
        />
        {parse.isError ? null : (
          <FieldDescription>{t('np.intake.rawHint')}</FieldDescription>
        )}
        {rawContent.length > 50_000 ? (
          <FieldError>{t('np.intake.rawTooLong')}</FieldError>
        ) : null}
      </Field>
      <div className='flex justify-end'>
        <Button
          disabled={
            parse.isPending || !rawContent.trim() || rawContent.length > 50_000
          }
          onClick={() => {
            setError(undefined);
            parse.mutate();
          }}
        >
          {parse.isPending ? (
            <Spinner data-icon='inline-start' />
          ) : (
            <WandSparklesIcon data-icon='inline-start' />
          )}
          {parse.isPending ? t('np.intake.parsing') : t('np.intake.parse')}
        </Button>
      </div>
    </section>
  );
}

function BatchView({
  batchId,
  onClose,
}: {
  readonly batchId: string;
  readonly onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const batch = useQuery({
    queryKey: npKeys.intakeBatch(batchId),
    queryFn: ({ signal }) => fetchIntakeBatch(api, batchId, signal),
  });
  if (batch.isError && !batch.data) {
    return (
      <Alert variant='destructive'>
        <AlertCircleIcon />
        <AlertDescription>
          {batch.error instanceof ApiClientError && batch.error.status === 404
            ? t('np.intake.notFound')
            : t('np.common.requestFailed')}
        </AlertDescription>
      </Alert>
    );
  }
  if (!batch.data) {
    return (
      <div role='status' aria-label={t('status.loading')} className='space-y-2'>
        <Skeleton className='h-8 w-1/3' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }
  return <BatchEditor detail={batch.data} onClose={onClose} />;
}
