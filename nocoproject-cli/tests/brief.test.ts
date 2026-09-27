import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyBriefBlock, BRIEF_BEGIN, BRIEF_END, buildBrief, buildTurnPrompt, writeBrief } from '../src/daemon/brief.js';
import { claimedRun } from './helpers/fixtures.js';

describe('brief', () => {
  it('renders the runtime block', () => {
    expect(buildBrief(claimedRun())).toMatchSnapshot();
  });

  it('lists only agent transitions', () => {
    const brief = buildBrief(claimedRun({ agentTransitions: [{ from: 'todo', to: 'in_progress' }] }));
    expect(brief).toContain('`todo` → `in_progress`');
    expect(brief).not.toContain('`in_progress` → `in_review`');
  });

  it('appends to files without a block and keeps outside content', () => {
    const block = buildBrief(claimedRun());
    const out = applyBriefBlock('# My project\n\nRules here.\n', block);
    expect(out.startsWith('# My project\n\nRules here.\n\n' + BRIEF_BEGIN)).toBe(true);
    expect(out.endsWith(`${BRIEF_END}\n`)).toBe(true);
  });

  it('replaces the block in place', () => {
    const before = `intro\n${BRIEF_BEGIN}\nold stuff\n${BRIEF_END}\noutro\n`;
    const out = applyBriefBlock(before, `${BRIEF_BEGIN}\nnew\n${BRIEF_END}`);
    expect(out).toBe(`intro\n${BRIEF_BEGIN}\nnew\n${BRIEF_END}\noutro\n`);
    expect(applyBriefBlock(out, `${BRIEF_BEGIN}\nnew\n${BRIEF_END}`)).toBe(out);
  });

  it('writes CLAUDE.md idempotently', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ncp-brief-'));
    writeFileSync(join(dir, 'CLAUDE.md'), 'Project notes.\n');
    const block = buildBrief(claimedRun());
    writeBrief(dir, 'CLAUDE.md', block);
    const once = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    writeBrief(dir, 'CLAUDE.md', block);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(once);
    expect(once.startsWith('Project notes.\n')).toBe(true);
  });
});

describe('turn prompt', () => {
  it('renders a mention turn', () => {
    expect(buildTurnPrompt(claimedRun(), { resumed: false })).toMatchSnapshot();
  });

  it('renders an assignment turn without --parent', () => {
    const prompt = buildTurnPrompt(claimedRun({ triggers: [{ type: 'assign' }] }), { resumed: true });
    expect(prompt).toMatchSnapshot();
    expect(prompt).not.toContain('--parent');
  });

  it('collects several merged triggers and replies to the last thread', () => {
    const prompt = buildTurnPrompt(
      claimedRun({
        triggers: [
          { type: 'mention', comment: { id: 'c1', authorName: 'Bob', content: 'first', parentId: null, rootId: 'c1' } },
          { type: 'reply', comment: { id: 'c3', authorName: 'Carol', content: 'second', parentId: 'c2', rootId: 'c2' } },
        ],
      }),
      { resumed: false },
    );
    expect(prompt).toContain('[NEW COMMENT] from Bob (reply with --parent c1):\n> first');
    expect(prompt).toContain('[NEW COMMENT] from Carol (reply with --parent c2):\n> second');
    expect(prompt).toContain('--content-file ./reply.md --parent c2`.');
  });
});
