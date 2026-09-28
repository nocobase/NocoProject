import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NpInboxNavIcon } from '../../client/components/np-inbox-nav-icon.js';
import { answer, renderNp } from './np-harness.js';

const api = vi.hoisted(() => ({ request: vi.fn() }));
const realtime = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload?: unknown }) => void>(),
  subscribe: vi.fn(),
  onOpen: vi.fn(() => () => {}),
}));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useService: () => realtime,
}));

afterEach(() => {
  api.request.mockReset();
  realtime.listeners.clear();
});

realtime.subscribe.mockImplementation(
  (topic: string, listener: (event: { payload?: unknown }) => void) => {
    realtime.listeners.set(topic, listener);
    return () => realtime.listeners.delete(topic);
  },
);

describe('inbox navigation badge', () => {
  it('shows the pending decision count and refreshes on np:inbox', async () => {
    let decision = 3;
    api.request.mockImplementation(
      answer({
        'GET np/inbox/pending-count': () => ({ data: { decision } }),
      }),
    );
    await renderNp(<NpInboxNavIcon />);
    expect(await screen.findByTestId('np-inbox-badge')).toHaveTextContent('3');
    expect(screen.getByText('3 pending')).toBeInTheDocument();

    decision = 120;
    realtime.listeners.get('np:inbox')?.({
      payload: { kind: 'inbox.changed' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('np-inbox-badge')).toHaveTextContent('99+'),
    );
  });

  it('shows no badge without pending decisions or when the count fails', async () => {
    api.request.mockImplementation(
      answer({
        'GET np/inbox/pending-count': { data: { decision: 0 } },
      }),
    );
    const view = await renderNp(<NpInboxNavIcon />);
    await waitFor(() => expect(api.request).toHaveBeenCalled());
    expect(screen.queryByTestId('np-inbox-badge')).toBeNull();
    view.unmount();

    api.request.mockRejectedValue(new Error('forbidden'));
    await renderNp(<NpInboxNavIcon />);
    await waitFor(() => expect(api.request).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('np-inbox-badge')).toBeNull();
  });
});
