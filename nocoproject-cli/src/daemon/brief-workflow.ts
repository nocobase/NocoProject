/**
 * Phase 2 workflow stage parts of the runtime brief and the turn prompt (NP-77 §1, §6):
 * `## Stage checklist` (the current status's checklist while required items are open) and the
 * `stageEntered` turn lines (the status entered and the rendered stage instruction). Pure string builders.
 */
import { checklistOf, type ClaimedRunV1 } from '../run-context.js';

/** `## Stage checklist`: the unchecked items of the current status (nothing when all are checked). */
export function stageChecklistSection(input: Pick<ClaimedRunV1, 'issue'>): string[] {
  const list = checklistOf(input);
  if (!list || list.statusKey !== input.issue.statusKey) return [];
  const open = list.items.filter((item) => !item.checked);
  if (open.length === 0) return [];
  return [
    '## Stage checklist',
    '',
    `The workflow asks for these items while ${input.issue.identifier} is \`${list.statusKey}\` (not yet checked):`,
    '',
    ...open.map((item) => `- ${item.required ? '**(required)** ' : ''}${item.label} (\`${item.itemKey}\`)`),
    '',
    `The server refuses to move the issue out of \`${list.statusKey}\` (except to a cancelled status) while a required item is unchecked (\`CHECKLIST_INCOMPLETE\`). Say in your delivery comment which items you completed so they can be checked.`,
    '',
  ];
}

type PromptInput = Pick<ClaimedRunV1, 'triggers'>;

/** The lines a `stageEntered` trigger adds to the turn prompt. */
export function stageEnteredLines(trigger: PromptInput['triggers'][number], quote: (text: string) => string): string[] {
  const stage = trigger.stage;
  const lines = [
    stage ? `The issue entered \`${stage.to}\` (from \`${stage.from}\`) and the workflow asked you to work on this stage.` : 'The issue entered a new stage and the workflow asked you to work on it.',
  ];
  const instruction = stage?.instruction?.trim();
  if (instruction) lines.push('Stage instruction (阶段指令):', quote(instruction));
  return lines;
}
