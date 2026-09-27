import type { ClaimedRun } from '../../src/protocol.js';

export function claimedRun(overrides: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    run: { id: '7301234567890123', agentId: 'a1', runtimeId: 'rt1', attempt: 1, priority: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    token: 'npr_0123456789abcdef0123456789abcdef01234567',
    agent: { id: 'a1', name: 'Coder', instructions: 'Write tests first.\nKeep diffs small.', provider: 'claude', model: null },
    issue: { id: 'i12', identifier: 'NP-12', title: 'Fix login redirect', statusKey: 'todo', ownerName: 'Alice' },
    statusCatalog: [],
    agentTransitions: [
      { from: 'todo', to: 'in_progress' },
      { from: 'blocked', to: 'in_progress' },
      { from: 'in_progress', to: 'in_review' },
      { from: 'in_progress', to: 'blocked' },
    ],
    triggers: [
      { type: 'mention', comment: { id: 'c9', authorName: 'Alice', content: '@Coder please fix this.\nIt breaks on Safari.', parentId: null, rootId: 'c9' } },
    ],
    session: { providerSessionId: null, workDir: null, fresh: true },
    server: { url: 'http://127.0.0.1:13000/main', protocolVersion: 1 },
    leaseSeconds: 45,
    ...overrides,
  };
}
