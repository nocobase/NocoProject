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
});
