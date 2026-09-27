import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircleIcon, WandSparklesIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';

import { NpDetailSkeleton } from '@/components/np-states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import { createIntakeBatch, fetchIntakeBatch } from '../api-intake.js';
import { fetchProjects } from '../api.js';
import { npKeys } from '../constants.js';
import { PropertySelect } from '../issues/detail/property-fields.js';
import { BatchEditor } from './batch-editor.js';

/**
 * The two panels of batch entry (iteration 2 §E): the composer that sends pasted text to the parser, and the editor
 * of one parsed batch. The drawer (`drawer.tsx`) switches between them by `?batch=`.
 */
export function IntakeComposer({
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
      toast.add({
        type: 'success',
        title: t('np.intake.parsedToast', { count: detail.drafts.length }),
      });
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
    <section className='space-y-4'>
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

export function IntakeBatchView({
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
  if (!batch.data) return <NpDetailSkeleton />;
  return <BatchEditor detail={batch.data} onClose={onClose} />;
}
