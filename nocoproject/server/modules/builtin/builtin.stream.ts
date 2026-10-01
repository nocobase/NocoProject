/**
 * Mirrors the AI plugin's stream into run events (NP-219, protocol-runtime-types.md §6.6): consecutive `content`
 * pieces become one `text` event, written when a tool call, reasoning or the end interrupts them; a reasoning block
 * (start … stop) becomes one `thinking` event. Tool calls are recorded by the tool box, which sees the arguments and
 * the result; only a call it never saw (a tool that does not exist) is written here, as an `error`. The plugin's
 * persistence is not an extension point, so this is a mirror, not a token-by-token transcript.
 */
import type { BuiltinStreamEvent } from './builtin.engine.js';
import type { RunEventDraft } from './builtin.toolbox.js';

/** The summary of a completed run: its last text, cut to this many characters. */
export const SUMMARY_MAX = 2000;

export interface StreamRecorder {
  accept(event: BuiltinStreamEvent): Promise<void>;
  /** Writes what is still buffered. */
  finish(): Promise<void>;
  /** The last text segment the model produced (null when there was none). */
  readonly summary: string | null;
  /** Whether the model produced any text or called any tool. */
  readonly produced: boolean;
}

export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        typeof part === 'string'
          ? part
          : typeof (part as { text?: unknown })?.text === 'string'
            ? (part as { text: string }).text
            : '',
      )
      .join('');
  return content === null || content === undefined
    ? ''
    : JSON.stringify(content);
}

export function createStreamRecorder(
  record: (events: readonly RunEventDraft[]) => Promise<void>,
  ownTools: ReadonlySet<string>,
): StreamRecorder {
  let text = '';
  let thinking: string | null = null;
  let summary: string | null = null;
  let produced = false;

  async function flushText(): Promise<void> {
    if (!text.trim()) {
      text = '';
      return;
    }
    const content = text;
    text = '';
    summary = content.trim();
    await record([{ type: 'text', content }]);
  }

  async function flushThinking(): Promise<void> {
    const content = thinking;
    thinking = null;
    if (content?.trim()) await record([{ type: 'thinking', content }]);
  }

  return {
    get summary() {
      return summary === null ? null : summary.slice(0, SUMMARY_MAX);
    },
    get produced() {
      return produced;
    },
    async accept(event) {
      switch (event.type) {
        case 'content': {
          const piece = textOf((event as { content: unknown }).content);
          if (piece) produced = true;
          text += piece;
          return;
        }
        case 'reasoning': {
          const { action, content } = event as {
            action: 'start' | 'content' | 'stop';
            content?: unknown;
          };
          if (action === 'start') {
            await flushText();
            thinking = '';
          } else if (action === 'content') {
            thinking = (thinking ?? '') + textOf(content);
          } else {
            await flushThinking();
          }
          return;
        }
        case 'tool_calls':
          produced = true;
          await flushText();
          return;
        case 'tool_call_status': {
          const { status } = event as {
            status: {
              toolCall: { name: string };
              invokeStatus: string;
              content?: unknown;
            };
          };
          if (
            status.invokeStatus === 'error' &&
            !ownTools.has(status.toolCall.name)
          )
            await record([
              {
                type: 'error',
                tool: status.toolCall.name,
                content: `Tool ${status.toolCall.name} failed: ${textOf(status.content)}`,
              },
            ]);
          return;
        }
        default:
          return;
      }
    },
    async finish() {
      await flushThinking();
      await flushText();
    },
  };
}
