import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import IntakeDrawer from '../../client/pages/np/intake/drawer.js';
import { answer, type RequestOptions, renderNp } from './np-harness.js';

const api = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));

const NOW = new Date().toISOString();
const BATCH = {
  id: 'b1',
  projectId: 'p1',
  projectName: 'Website',
  source: 'paste',
  parser: 'heuristic',
  status: 'draft',
  createdAt: NOW,
};

const COMMON = {
  'GET np/projects': { data: [{ id: 'p1', name: 'Website' }] },
  'GET np/agents': { data: [] },
  'GET np/members': {
    data: [{ userId: 'u1', name: 'Zhou', email: null, role: 'owner' }],
  },
  'GET np/labels': { data: [] },
  'GET np/me': { data: { userId: 'u1', name: 'Zhou' } },
  'GET np/intake/batches': { data: [] },
};

beforeEach(() => {
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

describe('batch entry', () => {
  it('opens as a drawer over the project page with the project preselected', async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    api.request.mockImplementation(
      answer({
        ...COMMON,
        'POST np/intake/batches': (options: RequestOptions) => {
          posted.push(options.json);
          return { data: { batch: BATCH, drafts: [] } };
        },
      }),
    );
    await renderNp(<IntakeDrawer />, {
      url: '/projects/p1/intake',
      path: '/projects/:projectId/intake',
    });
    expect(
      await screen.findByRole('dialog', { name: 'Batch entry' }),
    ).toBeVisible();
    await user.type(
      screen.getByRole('textbox', { name: 'Text to split into issues' }),
      'One',
    );
    await user.click(screen.getByRole('button', { name: 'Split into drafts' }));
    await waitFor(() =>
      expect(posted).toEqual([
        { source: 'paste', rawContent: 'One', projectId: 'p1' },
      ]),
    );
  });

  it('parses pasted text for the preselected project and opens the drafts', async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    api.request.mockImplementation(
      answer({
        ...COMMON,
        'POST np/intake/batches': (options: RequestOptions) => {
          posted.push(options.json);
          return {
            data: {
              batch: BATCH,
              parser: 'heuristic',
              drafts: [
                {
                  position: 1,
                  parentPosition: null,
                  fields: { title: 'Design the form' },
                },
              ],
            },
          };
        },
      }),
    );
    await renderNp(<IntakeDrawer />, {
      url: '/issues/intake?project=p1',
      path: '/issues/intake',
    });

    await user.type(
      screen.getByRole('textbox', { name: 'Text to split into issues' }),
      '- Design the form',
    );
    await user.click(screen.getByRole('button', { name: 'Split into drafts' }));
    await waitFor(() =>
      expect(posted).toEqual([
        { source: 'paste', rawContent: '- Design the form', projectId: 'p1' },
      ]),
    );
    expect(await screen.findByText('Drafts (1)')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Row 1 Title' })).toHaveValue(
      'Design the form',
    );
  });

  it('validates rows, indents to set the parent, then saves and creates the issues', async () => {
    const user = userEvent.setup();
    const saved: unknown[] = [];
    api.request.mockImplementation(
      answer({
        ...COMMON,
        'GET np/intake/batches/b1': {
          data: {
            batch: BATCH,
            drafts: [
              { position: 1, parentPosition: null, fields: { title: 'Login' } },
              { position: 2, parentPosition: null, fields: { title: '' } },
            ],
          },
        },
        'PUT np/intake/batches/b1/drafts': (options: RequestOptions) => {
          const body = options.json as { drafts: unknown[] };
          saved.push(body.drafts);
          return { data: { drafts: body.drafts } };
        },
        'POST np/intake/batches/b1/confirm': {
          data: {
            issues: [{ id: '201', identifier: 'NP-201', title: 'Login' }],
          },
        },
      }),
    );
    await renderNp(<IntakeDrawer />, {
      url: '/issues/intake?batch=b1',
      path: '/issues/intake',
    });

    const problems = await screen.findByRole('list', {
      name: 'Problems in row 2',
    });
    expect(within(problems).getByText('Enter a title.')).toBeInTheDocument();
    const create = screen.getByRole('button', { name: 'Create 2 issues' });
    expect(create).toBeDisabled();

    await user.type(
      screen.getByRole('textbox', { name: 'Row 2 Title' }),
      'Validate email',
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Make row 2 a sub-issue of the row above',
      }),
    );
    expect(
      screen.queryByRole('list', { name: 'Problems in row 2' }),
    ).toBeNull();
    expect(create).toBeEnabled();

    await user.click(create);
    await waitFor(() =>
      expect(saved).toEqual([
        [
          { position: 1, parentPosition: null, fields: { title: 'Login' } },
          {
            position: 2,
            parentPosition: 1,
            fields: { title: 'Validate email' },
          },
        ],
      ]),
    );
    expect(await screen.findByRole('link', { name: /NP-201/ })).toHaveAttribute(
      'href',
      '/issues/201',
    );
  });

  it('does not create when the server reports a problem on save', async () => {
    const user = userEvent.setup();
    api.request.mockImplementation(
      answer({
        ...COMMON,
        'GET np/intake/batches/b1': {
          data: {
            batch: BATCH,
            drafts: [
              { position: 1, parentPosition: null, fields: { title: 'Login' } },
            ],
          },
        },
        'PUT np/intake/batches/b1/drafts': {
          data: {
            drafts: [
              {
                position: 1,
                parentPosition: null,
                fields: { title: 'Login' },
                validation: { errors: ['You cannot invoke that agent.'] },
              },
            ],
          },
        },
      }),
    );
    await renderNp(<IntakeDrawer />, {
      url: '/issues/intake?batch=b1',
      path: '/issues/intake',
    });
    await user.click(
      await screen.findByRole('button', { name: 'Create 1 issues' }),
    );
    expect(
      await screen.findByText('You cannot invoke that agent.'),
    ).toBeInTheDocument();
    expect(api.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'np/intake/batches/b1/confirm' }),
    );
  });
});
