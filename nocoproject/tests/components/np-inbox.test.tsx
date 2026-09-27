import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import locales from '../../client/locales/index.js';
import InboxPage from '../../client/pages/np/inbox/index.js';
import type { InboxItem } from '../../client/pages/np/types.js';

const api = vi.hoisted(() => ({ request: vi.fn() }));
const realtime = vi.hoisted(() => ({
  subscribe: vi.fn(() => () => {}),
  onOpen: vi.fn(() => () => {}),
}));
const toast = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useService: () => realtime,
}));
vi.mock('@/components/ui/toast', () => ({ toast }));

const NOW = new Date().toISOString();

function item(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: 'n1',
    kind: 'decision',
    type: 'review_requested',
    issueId: '101',
    issueIdentifier: 'NP-1',
    title: 'NP-1 is ready for review',
    body: 'Claude Coder moved it to in review.',
    actorType: 'agent',
    actorName: 'Claude Coder',
    count: 1,
    readAt: null,
    archivedAt: null,
    resolvedAt: null,
    payload: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const DECISIONS = [
  item({}),
  item({
    id: 'n2',
    type: 'proposal_pending',
    issueId: '102',
    issueIdentifier: 'NP-2',
    title: 'Executor proposals on NP-2',
    count: 3,
    readAt: NOW,
  }),
];
const INFO = [
  item({
    id: 'n3',
    kind: 'info',
    type: 'commented',
    title: 'New comment on NP-1',
  }),
];

function respond(options: {
  path: string;
  method?: string;
  query?: Record<string, string>;
}) {
  if (options.path === 'np/inbox') {
    return Promise.resolve({
      data: options.query?.kind === 'info' ? INFO : DECISIONS,
      unread: { decision: 1, info: 4 },
    });
  }
  if (options.path === 'np/inbox/unread-count') {
    return Promise.resolve({ data: { decision: 1, info: 4 } });
  }
  if (options.method === 'POST') return Promise.resolve({ data: {} });
  return Promise.reject(new Error(`unexpected ${options.path}`));
}

async function renderInbox(entry = '/inbox') {
  const runtime = new I18nRuntime({
    defaultLocale: 'en-US',
    locales: ['en-US', 'zh-CN'],
    applicationNamespace: 'test-app',
  });
  runtime.registerApplicationNamespace('test-app', locales);
  await runtime.init('en-US');
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <I18nProvider runtime={runtime}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path='/inbox' element={<InboxPage />} />
            <Route path='/issues/:issueId' element={<p>issue page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  api.request.mockReset();
  toast.add.mockReset();
  realtime.subscribe.mockClear();
});

describe('inbox', () => {
  it('shows both tabs with unread counts and the decisions first', async () => {
    api.request.mockImplementation(respond);
    await renderInbox();

    expect(await screen.findByText('NP-1 is ready for review')).toBeVisible();
    const decisionTab = screen.getByRole('tab', { name: /Needs my decision/ });
    expect(within(decisionTab).getByLabelText('1 unread')).toBeVisible();
    const infoTab = screen.getByRole('tab', { name: /Notifications/ });
    expect(within(infoTab).getByLabelText('4 unread')).toBeVisible();

    // Unread cards say so; merged cards show how many events they carry.
    const list = screen.getByRole('list', { name: 'Needs my decision' });
    const [first, second] = within(list).getAllByRole('listitem');
    expect(within(first).getByText('Unread')).toBeInTheDocument();
    expect(within(first).getByText('Review requested')).toBeVisible();
    expect(within(second).queryByText('Unread')).toBeNull();
    expect(within(second).getByText('×3')).toBeVisible();

    expect(realtime.subscribe.mock.calls.map((call) => call[0])).toContain(
      'np:inbox',
    );
  });

  it('switches to notifications through the tab', async () => {
    const user = userEvent.setup();
    api.request.mockImplementation(respond);
    await renderInbox();
    await screen.findByText('NP-1 is ready for review');

    await user.click(screen.getByRole('tab', { name: /Notifications/ }));
    expect(await screen.findByText('New comment on NP-1')).toBeVisible();
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'np/inbox',
        query: { kind: 'info', archived: 'false' },
      }),
    );
  });

  it('opens the issue and marks the card read', async () => {
    const user = userEvent.setup();
    api.request.mockImplementation(respond);
    await renderInbox();

    await user.click(await screen.findByText('NP-1 is ready for review'));
    expect(await screen.findByText('issue page')).toBeVisible();
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'np/inbox/n1/read', method: 'POST' }),
      ),
    );
  });

  it('archives from the card menu and marks everything read', async () => {
    const user = userEvent.setup();
    api.request.mockImplementation(respond);
    await renderInbox();
    await screen.findByText('NP-1 is ready for review');

    await user.click(
      screen.getByRole('button', {
        name: 'Actions for NP-1 is ready for review',
      }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'np/inbox/n1/archive',
          method: 'POST',
        }),
      ),
    );

    await user.click(screen.getByRole('button', { name: /Mark all as read/ }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'np/inbox/read-all',
          method: 'POST',
          json: { kind: 'decision' },
        }),
      ),
    );
  });

  it('renders iteration 2 cards from type and payload, falling back to the English body', async () => {
    const user = userEvent.setup();
    const approval = item({
      id: 'n4',
      type: 'approval_pending',
      issueId: '104',
      issueIdentifier: 'NP-4',
      title: 'NP-4 Ship the release',
      body: 'Approval requested (English fallback)',
      actorName: 'Claude Coder',
      payload: { fromStatus: 'in_review', toStatus: 'done', requestId: 'ap1' },
    });
    const prReview = item({
      id: 'n5',
      type: 'pr_review',
      issueId: '105',
      title: 'NP-5 Fix login',
      body: 'PR is ready (English fallback)',
      payload: { repo: 'acme/app', number: 42 },
    });
    const bare = item({
      id: 'n6',
      type: 'pr_merged',
      title: 'NP-6 Docs',
      body: 'A PR was merged (English fallback)',
      payload: {},
    });
    api.request.mockImplementation(
      (options: {
        path: string;
        method?: string;
        query?: Record<string, string>;
      }) =>
        options.path === 'np/inbox'
          ? Promise.resolve({ data: [approval, prReview, bare] })
          : respond(options),
    );
    await renderInbox();

    expect(
      await screen.findByText(
        'Claude Coder asks to move it from In review to Done.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Approval requested')).toBeVisible();
    expect(screen.getByText('PR acme/app#42 is ready to merge.')).toBeVisible();
    expect(screen.getByText('PR ready to merge')).toBeVisible();
    expect(
      screen.getByText('A PR was merged (English fallback)'),
    ).toBeVisible();

    // An approval decision opens its issue, where the approval card is.
    await user.click(screen.getByText('NP-4 Ship the release'));
    expect(await screen.findByText('issue page')).toBeVisible();
  });

  it('acts on a decision inline from payload.actions and resolves the card at once', async () => {
    const user = userEvent.setup();
    const review = item({
      payload: {
        actions: [
          {
            key: 'accept',
            label: 'np.inboxActions.accept',
            kind: 'primary',
            method: 'POST',
            path: '/np/issues/101/deliveries/accept',
          },
          {
            key: 'requestChanges',
            label: 'np.inboxActions.requestChanges',
            kind: 'secondary',
            method: 'POST',
            path: '/np/issues/101/deliveries/request-changes',
            needsComment: true,
          },
          {
            key: 'open',
            label: 'np.inboxActions.open',
            kind: 'secondary',
            opensIssue: true,
          },
        ],
      },
    });
    let accept: (value: unknown) => void = () => {};
    api.request.mockImplementation(
      (options: { path: string; method?: string; json?: unknown }) => {
        if (options.path === 'np/inbox') {
          return Promise.resolve({ data: [review] });
        }
        if (options.path === 'np/issues/101/deliveries/accept') {
          return new Promise((resolve) => {
            accept = resolve;
          });
        }
        return respond(options as never);
      },
    );
    await renderInbox();

    const card = (await screen.findByText('NP-1 is ready for review')).closest(
      'li',
    ) as HTMLElement;
    expect(within(card).getByRole('button', { name: 'Accept' })).toBeVisible();
    expect(
      within(card).getByRole('button', { name: 'Request changes' }),
    ).toBeVisible();
    await user.click(within(card).getByRole('button', { name: 'Accept' }));
    // Optimistic: the card shows resolved before the server answers.
    expect(await within(card).findByText('Resolved')).toBeVisible();
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'np/issues/101/deliveries/accept',
        method: 'POST',
        json: {},
      }),
    );
    accept({ data: {} });
    await waitFor(() =>
      expect(toast.add).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success' }),
      ),
    );
  });

  it('asks for a comment before an action that needs one and sends it', async () => {
    const user = userEvent.setup();
    const review = item({
      payload: {
        actions: [
          {
            key: 'requestChanges',
            label: 'np.inboxActions.requestChanges',
            kind: 'secondary',
            method: 'POST',
            path: '/np/issues/101/deliveries/request-changes',
            needsComment: true,
          },
        ],
      },
    });
    api.request.mockImplementation((options: { path: string }) =>
      options.path === 'np/inbox'
        ? Promise.resolve({ data: [review] })
        : respond(options as never),
    );
    await renderInbox();

    await user.click(
      await screen.findByRole('button', { name: 'Request changes' }),
    );
    const box = screen.getByRole('textbox', {
      name: 'Request changes: NP-1 is ready for review',
    });
    const send = screen.getByRole('button', { name: 'Request changes' });
    expect(send).toBeDisabled();
    await user.type(box, 'Please add tests');
    await user.click(send);
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'np/issues/101/deliveries/request-changes',
          method: 'POST',
          json: { comment: 'Please add tests' },
        }),
      ),
    );
  });

  it('falls back to type defaults: a blocked agent gets a reply sent as a comment', async () => {
    const user = userEvent.setup();
    const blocked = item({
      id: 'n7',
      type: 'agent_blocked',
      title: 'Claude Coder is blocked on NP-1',
      payload: null,
    });
    api.request.mockImplementation((options: { path: string }) =>
      options.path === 'np/inbox'
        ? Promise.resolve({ data: [blocked] })
        : respond(options as never),
    );
    await renderInbox();

    expect(
      await screen.findByRole('button', { name: 'Reassign' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    await user.type(
      screen.getByRole('textbox', {
        name: 'Reply: Claude Coder is blocked on NP-1',
      }),
      'Use the staging key{Meta>}{Enter}{/Meta}',
    );
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'np/issues/101/comments',
          method: 'POST',
          json: { content: 'Use the staging key' },
        }),
      ),
    );
  });

  it('opens an external PR in a new tab and an issue action in the app', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const pr = item({
      id: 'n8',
      type: 'pr_review',
      title: 'NP-1 PR ready',
      readAt: NOW,
      payload: { url: 'https://github.com/acme/app/pull/7' },
    });
    api.request.mockImplementation((options: { path: string }) =>
      options.path === 'np/inbox'
        ? Promise.resolve({ data: [pr] })
        : respond(options as never),
    );
    await renderInbox();

    await user.click(await screen.findByRole('button', { name: 'Open PR' }));
    expect(open).toHaveBeenCalledWith(
      'https://github.com/acme/app/pull/7',
      '_blank',
      'noopener,noreferrer',
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('issue page')).toBeVisible();
    open.mockRestore();
  });

  it('puts the card back and says so when the action fails', async () => {
    const user = userEvent.setup();
    const approval = item({
      id: 'n9',
      type: 'approval_pending',
      title: 'NP-9 needs approval',
      payload: { approvalId: 'ap9', fromStatus: 'in_review', toStatus: 'done' },
    });
    let listed = [approval];
    api.request.mockImplementation(
      (options: { path: string; method?: string }) => {
        if (options.path === 'np/inbox')
          return Promise.resolve({ data: listed });
        if (options.path === 'np/approvals/ap9/approve') {
          listed = [approval];
          return Promise.reject(new Error('offline'));
        }
        return respond(options as never);
      },
    );
    await renderInbox();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(toast.add).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      ),
    );
    expect(
      await screen.findByRole('button', { name: 'Approve' }),
    ).toBeEnabled();
  });
});
