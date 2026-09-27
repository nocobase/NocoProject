import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import locales from '../../client/locales/index.js';
import IssuesPage from '../../client/pages/np/issues/index.js';
import type { IssueListItem } from '../../client/pages/np/types.js';

// One shared client for the whole file: a new object per call would make effects that depend on it re-run forever.
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

const ISSUES: IssueListItem[] = [
  {
    id: '101',
    number: 1,
    identifier: 'NP-1',
    title: 'Wire up the claim endpoint',
    statusKey: 'in_progress',
    priority: 'high',
    ownerUserId: 'u1',
    ownerName: 'Zhou',
    executorType: 'agent',
    executorId: 'a1',
    executorName: 'Claude Coder',
    activeRunCount: 1,
    updatedAt: new Date().toISOString(),
  },
  {
    id: '102',
    number: 2,
    identifier: 'NP-2',
    title: 'Write the protocol doc',
    statusKey: 'todo',
    priority: 'none',
    ownerUserId: 'u1',
    ownerName: 'Zhou',
    executorType: 'user',
    executorId: 'u2',
    executorName: 'Ada',
    activeRunCount: 0,
    updatedAt: new Date().toISOString(),
  },
];

async function renderPage() {
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
        <MemoryRouter initialEntries={['/issues']}>
          <Routes>
            <Route path='/issues' element={<IssuesPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  api.request.mockReset();
  realtime.subscribe.mockClear();
});

describe('issue list', () => {
  it('renders a row per issue with status, owner and executor', async () => {
    api.request.mockResolvedValue({ data: ISSUES });
    await renderPage();

    const firstRow = (
      await screen.findByText('Wire up the claim endpoint')
    ).closest('tr') as HTMLElement;
    expect(within(firstRow).getByRole('link', { name: 'NP-1' })).toBeVisible();
    expect(within(firstRow).getByText('In progress')).toBeVisible();
    expect(within(firstRow).getByText('High')).toBeVisible();
    expect(within(firstRow).getByText('Zhou')).toBeVisible();
    expect(within(firstRow).getByText('Claude Coder')).toBeVisible();

    const secondRow = screen
      .getByText('Write the protocol doc')
      .closest('tr') as HTMLElement;
    expect(within(secondRow).getByText('Todo')).toBeVisible();
    expect(within(secondRow).getByText('Ada')).toBeVisible();

    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'np/issues' }),
    );
  });

  it('marks agent executors and shows a working indicator while a run is active', async () => {
    api.request.mockResolvedValue({ data: ISSUES });
    await renderPage();

    const agentRow = (await screen.findByText('Claude Coder')).closest(
      'tr',
    ) as HTMLElement;
    expect(within(agentRow).getByText('Agent')).toBeVisible();
    expect(within(agentRow).getByText('Working')).toBeVisible();

    const personRow = screen.getByText('Ada').closest('tr') as HTMLElement;
    expect(within(personRow).queryByText('Agent')).toBeNull();
    expect(within(personRow).queryByText('Working')).toBeNull();
  });

  it('subscribes to issue and agent invalidation topics', async () => {
    api.request.mockResolvedValue({ data: ISSUES });
    await renderPage();
    await screen.findByText('Wire up the claim endpoint');
    const topics = realtime.subscribe.mock.calls.map((call) => call[0]);
    expect(topics).toEqual(expect.arrayContaining(['np:issues', 'np:agents']));
  });

  it('shows the empty state when there are no issues', async () => {
    api.request.mockResolvedValue({ data: [] });
    await renderPage();
    expect(await screen.findByText('No issues yet')).toBeVisible();
  });

  it('offers a retry when loading fails', async () => {
    api.request.mockRejectedValue(new Error('offline'));
    await renderPage();
    expect(await screen.findByText('Unable to load issues')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});
