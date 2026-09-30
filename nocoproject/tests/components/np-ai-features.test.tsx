import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiFeatureFields } from '../../client/pages/np/config/ai-feature-fields.js';
import NewIssuePage from '../../client/pages/np/issues/new.js';
import type {
  AiFeatureEffective,
  AiFeatureSetting,
  AiModelOption,
} from '../../client/pages/np/types.js';
import { answer, renderNp } from './np-harness.js';

const api = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useService: () => ({ repository: () => ({ uploadOne: vi.fn() }) }),
}));

const MODELS: AiModelOption[] = [
  {
    llmService: 'fast',
    title: 'Fast service',
    models: [{ label: 'Flash', value: 'flash-1' }],
  },
];
const ON: AiFeatureSetting = { enabled: true, parser: 'auto', model: null };

function effective(
  patch: Partial<AiFeatureEffective> = {},
): AiFeatureEffective {
  return {
    active: true,
    fallback: null,
    source: 'default',
    model: {
      llmService: 'fast',
      model: 'flash-1',
      serviceTitle: 'Fast service',
      label: 'Flash',
    },
    ...patch,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  api.request.mockReset();
  vi.unstubAllGlobals();
});

describe('AI feature settings (NP-205)', () => {
  it('shows the model in use and reports edits', async () => {
    const onChange = vi.fn();
    await renderNp(
      <AiFeatureFields
        feature='intakeAi'
        draft={ON}
        models={MODELS}
        effective={effective()}
        canEdit
        onChange={onChange}
      />,
    );
    expect(
      screen.getByText('Model in use: Fast service · Flash (default)'),
    ).toBeVisible();
    await userEvent.setup().click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith({ ...ON, enabled: false });
  });

  it('says why rules are used when no model is configured', async () => {
    await renderNp(
      <AiFeatureFields
        feature='breakdownAi'
        draft={ON}
        models={[]}
        effective={effective({
          active: false,
          fallback: 'no_model',
          model: null,
          source: null,
        })}
        canEdit
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/No AI model is configured/u)).toBeVisible();
  });

  it('is read-only without the settings grant', async () => {
    await renderNp(
      <AiFeatureFields
        feature='intakeAi'
        draft={ON}
        models={MODELS}
        effective={effective()}
        canEdit={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('new issue dialog with AI draft switched off (NP-205)', () => {
  it('offers only the manual form', async () => {
    api.request.mockImplementation(
      answer({
        'GET np/projects': { data: [] },
        'GET np/agents': { data: [] },
        'GET np/members': { data: [] },
        'GET np/labels': { data: [] },
        'GET np/me': { data: { userId: 'u1', name: 'Zhou' } },
        'GET np/settings': {
          data: { defaultProcess: 'auto', intakeAi: { ...ON, enabled: false } },
        },
      }),
    );
    await renderNp(<NewIssuePage />, {
      url: '/issues/new?tab=ai',
      path: '/issues/new',
    });
    expect(await screen.findByRole('textbox', { name: 'Title' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'AI draft' })).toBeNull();
  });
});
