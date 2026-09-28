import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import locales from '../../client/locales/index.js';
import { ChecklistCard } from '../../client/pages/np/issues/detail/checklist-card.js';
import type { IssueChecklist } from '../../client/pages/np/types-phase2.js';

const api = vi.hoisted(() => ({ request: vi.fn() }));
const toast = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));
vi.mock('@/components/ui/toast', () => ({ toast }));

function checklist(overrides: Partial<IssueChecklist> = {}): IssueChecklist {
  return {
    statusKey: 'in_review',
    current: true,
    complete: false,
    items: [
      {
        itemKey: 'tests',
        label: 'Tests pass',
        required: true,
        checked: false,
        checkedByType: null,
        checkedById: null,
        checkedByName: null,
        checkedAt: null,
      },
      {
        itemKey: 'docs',
        label: 'Docs updated',
        required: false,
        checked: true,
        checkedByType: 'user',
        checkedById: 'u1',
        checkedByName: 'Ada',
        checkedAt: '2026-09-27T10:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

async function renderCard() {
  const runtime = new I18nRuntime({
    defaultLocale: 'en-US',
    locales: ['en-US', 'zh-CN'],
    applicationNamespace: 'test-app',
  });
  runtime.registerApplicationNamespace('test-app', locales);
  await runtime.init('en-US');
  const client = new QueryClient();
  render(
    <I18nProvider runtime={runtime}>
      <QueryClientProvider client={client}>
        <ChecklistCard issueId='100' />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  api.request.mockReset();
  toast.add.mockReset();
});

describe('issue checklist card', () => {
  it('renders nothing while the current status has no checklist', async () => {
    api.request.mockResolvedValue({ data: [] });
    await renderCard();
    await waitFor(() => expect(api.request).toHaveBeenCalled());
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('lists the current checklist and marks it incomplete', async () => {
    api.request.mockResolvedValue({ data: [checklist()] });
    await renderCard();
    expect(
      await screen.findByRole('region', { name: 'Checklist' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Tests pass')).toBeInTheDocument();
    expect(screen.getByText('Docs updated')).toBeInTheDocument();
    expect(
      screen.getByText('Check the required items before leaving this status.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /Tests pass/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /Docs updated/ }),
    ).toBeChecked();
  });

  it('checks an item through the PATCH endpoint', async () => {
    const user = userEvent.setup();
    api.request.mockResolvedValueOnce({ data: [checklist()] });
    await renderCard();
    await screen.findByRole('region', { name: 'Checklist' });

    api.request.mockResolvedValueOnce({ data: checklist() });
    await user.click(screen.getByRole('checkbox', { name: /Tests pass/ }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'np/issues/100/checklists/in_review/items/tests',
          method: 'PATCH',
          json: { checked: true },
        }),
      ),
    );
  });
});
