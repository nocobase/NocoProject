/**
 * The AI intake parser (docs/phase1/iteration-2-contract.md §E): one unattended `invoke()` of a fixed agent (no
 * tools) with a Zod `responseFormat`, under a 30 second `AbortSignal`, as the member who asked.
 *
 * It needs the AI employee plugin's `agentServiceFactoryToken` and a conversation for the session; the provider hands
 * both in as the narrow `AiAgentFactory` below, so tests use a fake. The caller falls back to the heuristic parser
 * when this throws, times out or returns nothing.
 */
import { z } from 'zod';

import type {
  IntakeDraftFields,
  IntakeDraftInput,
} from '../shared/protocol.js';
import {
  MAX_DRAFTS,
  MAX_TITLE_LENGTH,
  type IntakeParseInput,
  type IntakeParser,
} from './parser.js';

export const AI_PARSE_TIMEOUT_MS = 30_000;

const draftSchema = z.object({
  position: z.number().int(),
  parentPosition: z.number().int().nullable(),
  title: z.string(),
  description: z.string().nullable().optional(),
  priority: z
    .enum(['urgent', 'high', 'medium', 'low', 'none'])
    .nullable()
    .optional(),
  labels: z.array(z.string()).nullable().optional(),
  stage: z.number().int().nullable().optional(),
});

export const intakeResponseSchema = z.object({ drafts: z.array(draftSchema) });
export type IntakeAiResponse = z.infer<typeof intakeResponseSchema>;

/** The slice of the AI employee plugin the parser uses (see `server/providers/np.ts`). */
export interface AiAgentFactory {
  /** Creates a conversation owned by `userId` and returns its session id. */
  createSession(userId: string, title: string): Promise<string>;
  createAgent(options: {
    sessionId: string;
    userId: string;
    systemPrompt: string;
  }): Promise<{
    invoke(request: {
      userMessages: { role: 'user'; content: string }[];
      responseFormat: typeof intakeResponseSchema;
      signal: AbortSignal;
    }): Promise<{ structuredResponse?: IntakeAiResponse }>;
  }>;
}

export interface AiIntakeParser extends IntakeParser {
  /** Parses as `userId`; returns the drafts and the conversation session id. */
  parseAs(
    input: IntakeParseInput,
    userId: string,
    signal?: AbortSignal,
  ): Promise<{ drafts: IntakeDraftInput[]; sessionId: string }>;
}

export function intakeSystemPrompt(input: IntakeParseInput): string {
  return [
    'You split a pasted requirement list into issue drafts for a software project tracker.',
    input.project
      ? `Project: ${input.project.name}${input.project.description ? ` — ${input.project.description}` : ''}`
      : 'No project was chosen.',
    input.workflow
      ? `Workflow: ${input.workflow.name} (${input.workflow.statuses.join(', ')}).`
      : '',
    `Existing labels (reuse them when they fit): ${input.labels.length ? input.labels.join(', ') : 'none'}.`,
    'Priority is one of urgent, high, medium, low, none.',
    'Number drafts from 1 in reading order (position). A sub-requirement points to its parent with parentPosition,',
    'which must be a smaller position; top-level drafts have parentPosition null.',
    'When sub-tasks of one parent depend on each other, put them in stages: stage 1 runs first, stage 2 after it, and so',
    'on; only sub-tasks have a stage. Titles are short (at most 200 characters); put details in description.',
    'Keep the language of the input. Do not invent requirements that are not in the text.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Renumbers the model's drafts 1..n and drops parents that do not point backwards. */
export function normalizeAiDrafts(
  response: IntakeAiResponse | undefined,
): IntakeDraftInput[] {
  const items = (response?.drafts ?? []).slice(0, MAX_DRAFTS);
  const renumbered = new Map<number, number>();
  const drafts: IntakeDraftInput[] = [];
  for (const item of items) {
    const title = item.title
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, MAX_TITLE_LENGTH);
    if (!title) continue;
    const position = drafts.length + 1;
    if (!renumbered.has(item.position)) renumbered.set(item.position, position);
    const parentPosition =
      item.parentPosition === null
        ? null
        : (renumbered.get(item.parentPosition) ?? null);
    const labels = (item.labels ?? [])
      .map((label) => label.trim())
      .filter(Boolean);
    const fields: IntakeDraftFields = {
      title,
      ...(item.description ? { description: item.description } : {}),
      ...(item.priority ? { priority: item.priority } : {}),
      ...(labels.length > 0 ? { labels } : {}),
      ...(typeof item.stage === 'number' &&
      parentPosition !== null &&
      parentPosition < position
        ? { stage: item.stage }
        : {}),
    };
    drafts.push({
      position,
      parentPosition:
        parentPosition !== null && parentPosition < position
          ? parentPosition
          : null,
      fields,
    });
  }
  return drafts;
}

export function createAiIntakeParser(
  factory: AiAgentFactory,
  timeoutMs = AI_PARSE_TIMEOUT_MS,
): AiIntakeParser {
  async function parseAs(
    input: IntakeParseInput,
    userId: string,
    signal?: AbortSignal,
  ) {
    const sessionId = await factory.createSession(userId, 'NocoProject intake');
    const agent = await factory.createAgent({
      sessionId,
      userId,
      systemPrompt: intakeSystemPrompt(input),
    });
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    // The signal stops the run; the race makes sure the caller gets its answer on time even if it does not.
    const aborted = new Promise<never>((_resolve, reject) => {
      combined.addEventListener('abort', () =>
        reject(new Error('The AI intake parser timed out.')),
      );
    });
    aborted.catch(() => undefined);
    const { structuredResponse } = await Promise.race([
      agent.invoke({
        userMessages: [{ role: 'user', content: input.rawContent }],
        responseFormat: intakeResponseSchema,
        signal: combined,
      }),
      aborted,
    ]);
    return { drafts: normalizeAiDrafts(structuredResponse), sessionId };
  }
  return {
    kind: 'ai',
    parseAs,
    async parse() {
      throw new Error('The AI intake parser needs a user; call parseAs.');
    },
  };
}
