import { ApiClientError } from '@nocobase/app-client';
import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import locales from '../../client/locales/index.js';
import IssueDetailPage from '../../client/pages/np/issues/detail/index.js';

const api = vi.hoisted(() => ({ request: vi.fn() }));
const realtime = vi.hoisted(() => ({
  subscribe: vi.fn(() => () => {}),
  onOpen: vi.fn(() => () => {}),
}));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useService: () => realtime,
}));

const NOW = new Date().toISOString();

const DETAIL = {
  issue: {
    id: '101',
    number: 1,
    identifier: 'NP-1',
    title: 'Wire up the claim endpoint',
    description: 'Use **SKIP LOCKED**.',
    statusKey: 'todo',
    priority: 'high',
    ownerUserId: 'u1',
    ownerName: 'Zhou',
    executorType: 'agent',
    executorId: 'a1',
    executorName: 'Claude Coder',
    activeRunCount: 0,
    revision: 3,
    createdAt: NOW,
    updatedAt: NOW,
  },
  comments: [
    {
      id: 'c1',
      authorType: 'user',
      authorId: 'u1',
      authorName: 'Zhou',
      content: 'Ping [@Claude Coder](mention://agent/a1)',
      parentId: null,
      createdAt: NOW,
    },
    {
      id: 'c2',
      authorType: 'agent',
      authorId: 'a1',
      content: 'On it.',
      parentId: 'c1',
      createdAt: NOW,
    },
  ],
  activities: [],
  runs: [
    {
      id: 'run-1',
      agentId: 'a1',
      status: 'failed',
      triggerType: 'mention',
      failureReason: 'runtimeOffline',
      createdAt: NOW,
      startedAt: NOW,
      finishedAt: NOW,
    },
  ],
};

const AGENTS = [
  {
    id: 'a1',
    name: 'Claude Coder',
    runtimeId: 'r1',
    runtimeStatus: 'online',
    provider: 'claude',
  },
];

function respond(options: { path: string; method?: string }) {
  if (options.path === 'np/issues/101' && !options.method) {
    return Promise.resolve({ data: DETAIL });
  }
  if (options.path === 'np/agents') return Promise.resolve({ data: AGENTS });
  if (options.path === 'np/me') {
    return Promise.resolve({ data: { userId: 'u1', name: 'Zhou' } });
  }
  return Promise.reject(new Error(`unexpected ${options.path}`));
}

async function renderDetail() {
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
        <MemoryRouter initialEntries={['/issues/101']}>
          <Routes>
            <Route path='/issues/:issueId' element={<IssueDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  // Narrow screen: the stacked layout avoids measuring resizable panels in jsdom.
  vi.stubGlobal('innerWidth', 500);
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  api.request.mockImplementation(respond);
});

afterEach(() => {
  api.request.mockReset();
  vi.unstubAllGlobals();
});

describe('issue detail', () => {
  it('renders the description, threaded comments with mention chips, and the execution log', async () => {
    await renderDetail();

    expect(
      await screen.findByRole('heading', {
        name: 'Wire up the claim endpoint',
      }),
    ).toBeVisible();
    expect(screen.getByText('SKIP LOCKED').tagName).toBe('STRONG');
    // The mention renders as a chip, not as a link to the mention:// URL.
    expect(screen.queryByRole('link', { name: '@Claude Coder' })).toBeNull();
    expect(screen.getByText('@Claude Coder')).toBeVisible();
    expect(screen.getByText('On it.')).toBeVisible();

    const log = screen.getByRole('region', { name: 'Execution log' });
    expect(within(log).getByText('Failed')).toBeVisible();
    expect(within(log).getByText('runtimeOffline')).toBeVisible();
    expect(within(log).getByRole('button', { name: /Retry/ })).toBeVisible();
    expect(within(log).queryByRole('button', { name: /Stop/ })).toBeNull();
    expect(
      within(log).getByText('View transcript').closest('a'),
    ).toHaveAttribute('href', '/issues/101/runs/run-1');
  });

  it('sends the revision with a title edit and reloads on a revision conflict', async () => {
    const user = userEvent.setup();
    api.request.mockImplementation(
      (options: { path: string; method?: string }) =>
        options.method === 'PATCH'
          ? Promise.reject(
              new ApiClientError('conflict', {
                status: 409,
                code: 'REVISION_CONFLICT',
                method: 'PATCH',
                url: '/api/np/issues/101',
              }),
            )
          : respond(options),
    );
    await renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Edit title' }));
    const input = screen.getByRole('textbox', { name: 'Title' });
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');

    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'np/issues/101',
          method: 'PATCH',
          json: { title: 'Renamed', revision: 3 },
        }),
      ),
    );
    const detailLoads = () =>
      api.request.mock.calls.filter(
        ([options]) =>
          (options as { path: string; method?: string }).path ===
            'np/issues/101' && !(options as { method?: string }).method,
      ).length;
    await waitFor(() => expect(detailLoads()).toBeGreaterThanOrEqual(2));
  });
});
