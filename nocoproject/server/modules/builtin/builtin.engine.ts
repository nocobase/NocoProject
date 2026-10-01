/**
 * What the built-in executor needs from the NocoBase AI plugin (NP-219, protocol-runtime-types.md §6.3, §8, §11.1):
 * a conversation to run in, one agent run with a fixed model, system prompt and tool list, streamed to completion, and
 * the conversation's messages for the token usage. The provider builds it from the plugin's public tokens
 * (`server/providers/np-builtin-agent.ts`); tests pass a scripted double. `null` from the source: the plugin is not
 * registered.
 */

/** The plugin's stream events this module reads (`AgentStreamEvent`); the others are ignored. */
export type BuiltinStreamEvent =
  | { readonly type: 'content'; readonly content: unknown }
  | {
      readonly type: 'reasoning';
      readonly action: 'start' | 'content' | 'stop';
      readonly content?: unknown;
    }
  | {
      readonly type: 'tool_call_status';
      readonly status: {
        readonly toolCall: { readonly id: string; readonly name: string };
        readonly invokeStatus: string;
        readonly content?: unknown;
      };
    }
  | { readonly type: string };

export interface BuiltinRunRequest {
  readonly sessionId: string;
  /** The member the run acts for: the conversation's owner and the plugin actor (never root). */
  readonly userId: string;
  readonly roles: readonly string[];
  readonly llmService: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly tools: readonly string[];
  readonly turnPrompt: string;
  readonly signal: AbortSignal;
}

export interface BuiltinUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  /** false: no message since the run started reported usage. */
  readonly reported: boolean;
}

export interface BuiltinAgentEngine {
  /** A new plugin conversation owned by `userId`; returns its session id. */
  createSession(input: {
    readonly userId: string;
    readonly title: string;
  }): Promise<string>;
  /** One agent run; rejects with the plugin's `AgentServiceError` (or anything else) when it fails. */
  run(request: BuiltinRunRequest): AsyncIterable<BuiltinStreamEvent>;
  /** Sums the usage of the messages created since `since`. */
  usage(input: {
    readonly userId: string;
    readonly sessionId: string;
    readonly since: Date;
  }): Promise<BuiltinUsage>;
}

export type BuiltinEngineSource = () => BuiltinAgentEngine | null;
