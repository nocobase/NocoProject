import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircleIcon,
  CheckIcon,
  CopyIcon,
  PlugZapIcon,
  RefreshCwIcon,
  SaveIcon,
} from 'lucide-react';
import { type ReactElement, useState } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

import {
  fetchGitConnection,
  saveGitConnection,
  testGitConnection,
} from '../api-iter2.js';
import { npKeys } from '../constants.js';
import { useNpFormatters } from '../format.js';
import type { GitConnectionView } from '../types.js';
import { generateSecret, gitConnectionChanges } from './github-model.js';

/**
 * Settings → GitHub (iteration 2 §C, owner/admin): the API base URL, the token used to read pull requests, and the
 * webhook secret GitHub signs deliveries with. Secrets are write-only — the page only shows whether each is set. The
 * webhook URL is what to paste into the repository's webhook settings; "Test connection" signs in with the token.
 */
export default function GithubSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const connection = useQuery({
    queryKey: npKeys.gitConnection,
    queryFn: () => fetchGitConnection(api),
    retry: (count, error) =>
      !(error instanceof ApiClientError && error.status === 403) && count < 2,
  });

  let content: ReactElement;
  if (connection.isError && !connection.data) {
    content = (
      <Alert variant='destructive'>
        <AlertCircleIcon />
        <AlertTitle>{t('np.github.loadFailed')}</AlertTitle>
        <AlertDescription>
          {connection.error instanceof ApiClientError &&
          connection.error.status === 403
            ? t('np.github.adminOnly')
            : t('np.common.requestFailed')}
        </AlertDescription>
      </Alert>
    );
  } else if (!connection.data) {
    content = <Skeleton className='h-64 w-full max-w-2xl' />;
  } else {
    content = (
      <GithubForm
        key={`${connection.data.apiBaseUrl}:${connection.data.tokenSet}:${connection.data.webhookSecretSet}`}
        connection={connection.data}
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('np.github.title')}
        description={t('np.github.description')}
      />
      {content}
    </PageContainer>
  );
}

function SecretState({ set }: { readonly set: boolean }): ReactElement {
  const { t } = useTranslation();
  return (
    <Badge variant={set ? 'secondary' : 'outline'}>
      {set ? t('np.github.set') : t('np.github.notSet')}
    </Badge>
  );
}

function GithubForm({
  connection,
}: {
  readonly connection: GitConnectionView;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const format = useNpFormatters();
  const [apiBaseUrl, setApiBaseUrl] = useState(connection.apiBaseUrl);
  const [token, setToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [clearSecret, setClearSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const changes = gitConnectionChanges(connection, {
    apiBaseUrl,
    token,
    webhookSecret,
    clearToken,
    clearSecret,
  });

  const save = useMutation({
    mutationFn: () => saveGitConnection(api, changes),
    onSuccess: (next) => {
      toast.add({ type: 'success', title: t('np.github.saved') });
      queryClient.setQueryData(npKeys.gitConnection, next);
      void queryClient.invalidateQueries({ queryKey: npKeys.gitConnection });
    },
    onError: (error: unknown) =>
      toast.add({
        type: 'error',
        priority: 'high',
        title:
          error instanceof ApiClientError && error.status === 403
            ? t('np.github.adminOnly')
            : t('np.common.requestFailed'),
      }),
  });
  const test = useMutation({
    mutationFn: () => testGitConnection(api),
    onSuccess: (result) =>
      toast.add(
        result.ok
          ? {
              type: 'success',
              title: t('np.github.testOk', { login: result.login ?? '—' }),
            }
          : {
              type: 'error',
              priority: 'high',
              title: t('np.github.testFailed'),
            },
      ),
    onError: (error: unknown) =>
      toast.add({
        type: 'error',
        priority: 'high',
        title:
          error instanceof ApiClientError &&
          error.code === 'GITHUB_NOT_CONFIGURED'
            ? t('np.github.notConfigured')
            : t('np.github.testFailed'),
      }),
  });

  async function copyWebhook(): Promise<void> {
    try {
      await navigator.clipboard.writeText(connection.webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.add({
        type: 'error',
        priority: 'high',
        title: t('np.connect.copyFailed'),
      });
    }
  }

  return (
    <FieldGroup className='max-w-2xl'>
      <Field>
        <FieldLabel htmlFor='np-github-base'>
          {t('np.github.apiBaseUrl')}
        </FieldLabel>
        <Input
          id='np-github-base'
          value={apiBaseUrl}
          placeholder='https://api.github.com'
          onChange={(event) => setApiBaseUrl(event.target.value)}
        />
        <FieldDescription>{t('np.github.apiBaseUrlHint')}</FieldDescription>
      </Field>
      <Field>
        <div className='flex items-center gap-2'>
          <FieldLabel htmlFor='np-github-token'>
            {t('np.github.token')}
          </FieldLabel>
          <SecretState set={connection.tokenSet && !clearToken} />
        </div>
        <div className='flex gap-2'>
          <Input
            id='np-github-token'
            type='password'
            autoComplete='off'
            value={token}
            placeholder={
              connection.tokenSet ? t('np.github.keepValue') : 'ghp_…'
            }
            onChange={(event) => {
              setToken(event.target.value);
              setClearToken(false);
            }}
          />
          {connection.tokenSet ? (
            <Button
              type='button'
              variant='outline'
              aria-pressed={clearToken}
              onClick={() => {
                setClearToken((value) => !value);
                setToken('');
              }}
            >
              {t('np.github.clear')}
            </Button>
          ) : null}
        </div>
        <FieldDescription>{t('np.github.tokenHint')}</FieldDescription>
      </Field>
      <Field>
        <div className='flex items-center gap-2'>
          <FieldLabel htmlFor='np-github-secret'>
            {t('np.github.webhookSecret')}
          </FieldLabel>
          <SecretState set={connection.webhookSecretSet && !clearSecret} />
        </div>
        <div className='flex gap-2'>
          <Input
            id='np-github-secret'
            type='password'
            autoComplete='off'
            value={webhookSecret}
            placeholder={
              connection.webhookSecretSet ? t('np.github.keepValue') : ''
            }
            onChange={(event) => {
              setWebhookSecret(event.target.value);
              setClearSecret(false);
            }}
          />
          <Button
            type='button'
            variant='outline'
            onClick={() => {
              setWebhookSecret(generateSecret());
              setClearSecret(false);
            }}
          >
            <RefreshCwIcon data-icon='inline-start' />
            {t('np.github.generate')}
          </Button>
          {connection.webhookSecretSet ? (
            <Button
              type='button'
              variant='outline'
              aria-pressed={clearSecret}
              onClick={() => {
                setClearSecret((value) => !value);
                setWebhookSecret('');
              }}
            >
              {t('np.github.clear')}
            </Button>
          ) : null}
        </div>
        <FieldDescription>{t('np.github.webhookSecretHint')}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor='np-github-webhook'>
          {t('np.github.webhookUrl')}
        </FieldLabel>
        <div className='flex gap-2'>
          <Input
            id='np-github-webhook'
            value={connection.webhookUrl}
            readOnly
            className='font-mono text-xs'
          />
          <Button
            type='button'
            variant='outline'
            size='icon'
            aria-label={copied ? t('np.connect.copied') : t('np.connect.copy')}
            onClick={() => void copyWebhook()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
        <FieldDescription>
          {t('np.github.webhookUrlHint')}{' '}
          {connection.lastEventAt
            ? t('np.github.lastEvent', {
                time: format.dateTime(connection.lastEventAt),
              })
            : t('np.github.noEvents')}
        </FieldDescription>
      </Field>
      <div className='flex flex-wrap justify-end gap-2'>
        <Button
          variant='outline'
          disabled={test.isPending || !connection.tokenSet}
          onClick={() => test.mutate()}
        >
          {test.isPending ? (
            <Spinner data-icon='inline-start' />
          ) : (
            <PlugZapIcon data-icon='inline-start' />
          )}
          {t('np.github.test')}
        </Button>
        <Button
          disabled={save.isPending || Object.keys(changes).length === 0}
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
