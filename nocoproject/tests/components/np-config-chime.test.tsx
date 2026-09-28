import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GeneralConfigTab from '../../client/pages/np/config/general.js';
import { answer, renderNp } from './np-harness.js';

const api = vi.hoisted(() => ({ request: vi.fn() }));
const chime = vi.hoisted(() => ({ play: vi.fn() }));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useService: () => ({ subscribe: () => () => {}, onOpen: () => () => {} }),
}));
vi.mock('../../client/pages/np/inbox/inbox-chime.js', async (original) => ({
  ...(await original<
    typeof import('../../client/pages/np/inbox/inbox-chime.js')
  >()),
  playInboxChime: chime.play,
}));

afterEach(() => {
  api.request.mockReset();
  chime.play.mockReset();
  localStorage.clear();
});

describe('sound reminder in settings (NP-108)', () => {
  it('lets a read-only member turn the inbox chime off and back on', async () => {
    const user = userEvent.setup();
    api.request.mockImplementation(
      answer({
        'GET np/me': { data: { userId: 'u1', name: 'Zhou' } },
        'GET np/members': {
          data: [{ userId: 'u1', name: 'Zhou', email: null, role: 'member' }],
        },
        'GET np/settings': { data: { canEdit: false } },
        'GET np/workflows': { data: [] },
      }),
    );
    await renderNp(<GeneralConfigTab />);

    expect(
      await screen.findByRole('heading', { name: 'My reminders' }),
    ).toBeVisible();
    const toggle = screen.getByRole('switch', { name: 'Sound reminder' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).not.toHaveAttribute('data-disabled');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem('np:inbox:chime')).toBe('off');
    expect(chime.play).not.toHaveBeenCalled();

    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(localStorage.getItem('np:inbox:chime')).toBe('on');
    expect(chime.play).toHaveBeenCalledWith({ preview: true });
  });
});
