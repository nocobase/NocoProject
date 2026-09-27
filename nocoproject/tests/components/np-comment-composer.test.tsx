import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import locales from '../../client/locales/index.js';
import { CommentComposer } from '../../client/pages/np/issues/detail/comment-composer.js';
import type {
  AgentListItem,
  ExecutorRef,
  IssueComment,
} from '../../client/pages/np/types.js';

const api = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));

const AGENTS: AgentListItem[] = [
  {
    id: '9001',
    name: 'Claude Coder',
    runtimeId: 'r1',
    runtimeStatus: 'online',
    provider: 'claude',
  },
  {
    id: '9002',
    name: 'Open Reviewer',
    runtimeId: 'r2',
    runtimeStatus: 'offline',
    provider: 'opencode',
  },
];

const agentName = (id: string | null | undefined): string | null =>
  AGENTS.find((agent) => agent.id === id)?.name ?? null;

async function renderComposer({
  executor = { type: 'none', id: null },
  replyTo = null,
}: {
  readonly executor?: ExecutorRef;
  readonly replyTo?: IssueComment | null;
} = {}) {
  const runtime = new I18nRuntime({
    defaultLocale: 'en-US',
    locales: ['en-US', 'zh-CN'],
    applicationNamespace: 'test-app',
  });
  runtime.registerApplicationNamespace('test-app', locales);
  await runtime.init('en-US');
  const queryClient = new QueryClient();
  const textareaRef = createRef<HTMLTextAreaElement>();
  render(
    <I18nProvider runtime={runtime}>
      <QueryClientProvider client={queryClient}>
        <CommentComposer
          issueId='101'
          executor={executor}
          agents={AGENTS}
          agentName={agentName}
          replyTo={replyTo}
          replyToName={replyTo ? 'Claude Coder' : null}
          onCancelReply={() => {}}
          textareaRef={textareaRef}
        />
      </QueryClientProvider>
    </I18nProvider>,
  );
  return screen.getByRole('combobox', { name: 'Comment' });
}

afterEach(() => {
  api.request.mockReset();
});

describe('comment composer', () => {
  it('inserts a mention link when an agent is picked from the @ list', async () => {
    const user = userEvent.setup();
    const textarea = await renderComposer();

    await user.type(textarea, 'Please @Cla');
    const listbox = screen.getByRole('listbox', { name: 'Agents' });
    expect(listbox).toBeVisible();
    expect(screen.queryByRole('option', { name: /Open Reviewer/ })).toBeNull();

    await user.click(screen.getByRole('option', { name: /Claude Coder/ }));

    expect(textarea).toHaveValue(
      'Please [@Claude Coder](mention://agent/9001) ',
    );
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('np-trigger-preview')).toHaveTextContent(
      'Will trigger Claude Coder.',
    );
  });

  it('picks the highlighted agent with the keyboard', async () => {
    const user = userEvent.setup();
    const textarea = await renderComposer();

    await user.type(textarea, '@');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(textarea).toHaveValue('[@Open Reviewer](mention://agent/9002) ');
  });

  it('closes the list on Escape without inserting anything', async () => {
    const user = userEvent.setup();
    const textarea = await renderComposer();

    await user.type(textarea, '@Cl');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(textarea).toHaveValue('@Cl');
  });

  it('previews the executor for a top-level comment and nothing for /note', async () => {
    const user = userEvent.setup();
    const textarea = await renderComposer({
      executor: { type: 'agent', id: '9002' },
    });
    const preview = screen.getByTestId('np-trigger-preview');

    await user.type(textarea, 'Go ahead');
    expect(preview).toHaveTextContent(
      'Will trigger Open Reviewer (the executor).',
    );

    await user.clear(textarea);
    await user.type(textarea, '/note just for the record');
    expect(preview).toHaveTextContent(
      'Note — this comment will not trigger any agent.',
    );
  });

  it('previews the replied agent and posts the reply with its parent id', async () => {
    const user = userEvent.setup();
    api.request.mockResolvedValue({
      data: { comment: { id: 'c9' }, triggered: [] },
    });
    const textarea = await renderComposer({
      executor: { type: 'agent', id: '9002' },
      replyTo: {
        id: 'c1',
        authorType: 'agent',
        authorId: '9001',
        content: 'Done',
        parentId: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
    });

    await user.type(textarea, 'Thanks');
    expect(screen.getByTestId('np-trigger-preview')).toHaveTextContent(
      'Will trigger Claude Coder (reply to its comment).',
    );

    await user.click(screen.getByRole('button', { name: /Reply/ }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'np/issues/101/comments',
          method: 'POST',
          json: { content: 'Thanks', parentId: 'c1' },
        }),
      ),
    );
    await waitFor(() => expect(textarea).toHaveValue(''));
  });
});
