// @vitest-environment node
/**
 * NP-219 built-in runtimes through the whole application (isolated SQLite) with the real AI plugin and its public
 * API only: the plugin's configured LLM services become candidates, enabling one runs the connectivity check through
 * the plugin's provider (here against a local OpenAI-compatible stub), a refusing service shows `check_failed`, and
 * without any configured service the candidates are empty (protocol-runtime-types.md §4.3).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { aiManagerToken } from '@nocobase/app-plugin-ai-employee/server';

import { npServicesToken } from '../../server/providers/np.ts';
import { createBuiltinEngineSource } from '../../server/providers/np-builtin-agent.ts';
import { startNpApp } from './np-app-harness.ts';
import { signIn, type Client } from './np-app-client.ts';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** `/ok/v1/chat/completions` answers like OpenAI; `/denied/v1/...` refuses the key. */
async function stubModels(): Promise<string> {
  const server: Server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.setHeader('content-type', 'application/json');
      if (request.url?.startsWith('/denied')) {
        response.statusCode = 401;
        response.end(
          JSON.stringify({
            error: {
              message: 'Incorrect API key provided',
              type: 'invalid_request_error',
            },
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1,
          model: 'stub-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'hello' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function service(name: string, baseURL: string) {
  return {
    name,
    title: name === 'stub' ? 'Stub models' : 'Denied models',
    provider: 'openai-completions',
    options: { apiKey: 'test-key', baseURL },
    enabledModels: [{ label: 'Stub model', value: 'stub-model' }],
    overrideEnabledModels: true,
    enabled: true,
  };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function admin(llmServices: unknown[]): Promise<Client> {
  const app = await startNpApp(cleanups, 'nocoproject-builtin-', {
    config: { ai: { llmServices } },
  });
  return signIn(app, '/auth/sign-in/username', {
    username: 'nocobase',
    password: 'admin123',
  });
}

describe('built-in runtimes through the application', () => {
  it('enables a configured LLM service, checks it through the plugin and refuses deleting it while in use', async () => {
    const base = await stubModels();
    const client = await admin([
      service('stub', `${base}/ok/v1`),
      service('denied', `${base}/denied/v1`),
    ]);
    const candidates = await json<{
      data: { plugin: string; services: { llmService: string }[] };
    }>(await client.get('/np/runtimes/builtin/candidates'));
    expect(candidates.data.plugin).toBe('ready');
    expect(
      candidates.data.services.map((item) => item.llmService).sort(),
    ).toEqual(['denied', 'stub']);

    const enabled = await client.send('POST', '/np/runtimes/builtin', {
      llmService: 'stub',
    });
    expect(enabled.status).toBe(201);
    const { data: runtime } = await json<{
      data: {
        id: string;
        status: string;
        runtimeType: string;
        enabledModels: unknown[];
      };
    }>(enabled);
    expect(runtime).toMatchObject({
      runtimeType: 'builtin',
      status: 'online',
      enabledModels: [{ label: 'Stub model', value: 'stub-model' }],
    });
    expect(
      (
        await client.send('POST', '/np/runtimes/builtin', {
          llmService: 'stub',
        })
      ).status,
    ).toBe(409);

    const denied = await client.send('POST', '/np/runtimes/builtin', {
      llmService: 'denied',
    });
    const deniedBody = await json<{
      data: { id: string; status: string; statusReason: string };
      details?: { message: string };
    }>(denied);
    expect(deniedBody.data).toMatchObject({
      status: 'offline',
      statusReason: 'check_failed',
    });
    expect(deniedBody.details?.message).toBeTruthy();

    const listed = await json<{ data: { id: string; runtimeType: string }[] }>(
      await client.get('/np/runtimes?runtimeType=builtin'),
    );
    expect(listed.data.map((item) => item.id).sort()).toEqual(
      [runtime.id, deniedBody.data.id].sort(),
    );
    expect((await client.get('/np/runtimes?runtimeType=cloud')).status).toBe(
      400,
    );

    const agent = await client.send('POST', '/np/agents', {
      name: 'Helper',
      instructions: '',
      runtimeId: runtime.id,
      runtimeType: 'builtin',
      provider: 'nocobase-ai',
      model: 'stub-model',
      capabilities: ['context.read', 'comment.create'],
    });
    expect(agent.status).toBe(201);
    const inUse = await client.send('DELETE', `/np/runtimes/${runtime.id}`);
    expect(inUse.status).toBe(409);
    expect((await json<{ code: string }>(inUse)).code).toBe('RUNTIME_IN_USE');
    const removed = await client.send(
      'DELETE',
      `/np/runtimes/${deniedBody.data.id}`,
    );
    expect(removed.status).toBe(200);
  }, 60_000);

  it('offers no candidates without a configured LLM service', async () => {
    const client = await admin([]);
    const candidates = await json<{ data: unknown }>(
      await client.get('/np/runtimes/builtin/candidates'),
    );
    expect(candidates.data).toEqual({ plugin: 'ready', services: [] });
    const enabled = await client.send('POST', '/np/runtimes/builtin', {
      llmService: 'stub',
    });
    expect(enabled.status).toBe(400);
    expect((await json<{ code: string }>(enabled)).code).toBe(
      'INVALID_LLM_SERVICE',
    );
    // Creating an agent still needs a type.
    const untyped = await client.send('POST', '/np/agents', {
      name: 'X',
      instructions: '',
      runtimeId: 'none',
      provider: 'echo',
    });
    expect((await json<{ code: string }>(untyped)).code).toBe(
      'INVALID_RUNTIME_TYPE',
    );
  }, 60_000);
});

/**
 * An OpenAI-compatible chat endpoint that first asks for the `np_kb_list` tool and, once a tool result is in the
 * messages, answers; streamed (SSE) with usage, as `ChatOpenAI.stream` requests it.
 */
async function stubAgentModel(): Promise<{ url: string; bodies: unknown[] }> {
  const bodies: unknown[] = [];
  const server: Server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as {
        stream?: boolean;
        messages?: { role: string }[];
      };
      bodies.push(body);
      const answered = (body.messages ?? []).some((m) => m.role === 'tool');
      const delta = answered
        ? { role: 'assistant', content: 'Nothing in the knowledge base.' }
        : {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'np_kb_list', arguments: '{}' },
              },
            ],
          };
      const finish = answered ? 'stop' : 'tool_calls';
      const usage = {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
      };
      if (!body.stream) {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            id: 'c',
            object: 'chat.completion',
            created: 1,
            model: 'stub-model',
            choices: [{ index: 0, message: delta, finish_reason: finish }],
            usage,
          }),
        );
        return;
      }
      response.setHeader('content-type', 'text/event-stream');
      const chunk = (choice: unknown, extra: object = {}) =>
        `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'stub-model', choices: choice ? [choice] : [], ...extra })}\n\n`;
      response.write(chunk({ index: 0, delta, finish_reason: null }));
      response.write(chunk({ index: 0, delta: {}, finish_reason: finish }));
      response.write(chunk(null, { usage }));
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    bodies,
  };
}

describe('built-in agent runs on the real AI plugin', () => {
  it('registers the np_* tools, runs a model-only agent that calls one, and reads the usage back', async () => {
    const model = await stubAgentModel();
    const app = await startNpApp(cleanups, 'nocoproject-builtin-run-', {
      config: { ai: { llmServices: [service('stub', model.url)] } },
    });
    const client = await signIn(app, '/auth/sign-in/username', {
      username: 'nocobase',
      password: 'admin123',
    });
    const { container } = app.application;
    const tools = container.resolve(aiManagerToken).toolsManager;
    const registered = await tools.getTools('np_comment_add');
    expect(registered).toMatchObject({
      scope: 'SPECIFIED',
      execution: 'backend',
      defaultPermission: 'ALLOW',
    });

    const services = container.resolve(npServicesToken);
    const engine = createBuiltinEngineSource(app.application)();
    expect(engine).not.toBeNull();
    const sessionId = await engine!.createSession({
      userId: client.userId,
      title: 'NocoProject · NP-1 Smoke',
    });
    // An active run for the session: the tool goes to the agent API, which refuses the fake token.
    const recorded: unknown[] = [];
    services.builtinToolbox.attach(sessionId, {
      runId: 'r1',
      token: 'npr_not-a-real-token',
      issue: 'NP-1',
      tools: new Set(['np_kb_list']),
      skills: [],
      record: async (events) => void recorded.push(...events),
    });
    const since = new Date(Date.now() - 1000);
    const events: { type: string }[] = [];
    for await (const event of engine!.run({
      sessionId,
      userId: client.userId,
      roles: ['np-owner'],
      llmService: 'stub',
      model: 'stub-model',
      systemPrompt: 'You are a test.',
      tools: ['np_kb_list'],
      turnPrompt: 'What does the knowledge base say?',
      signal: new AbortController().signal,
    }))
      events.push(event);
    services.builtinToolbox.detach(sessionId);

    expect(events.some((event) => event.type === 'content')).toBe(true);
    expect(recorded).toMatchObject([
      { type: 'toolUse', tool: 'np_kb_list' },
      {
        type: 'toolResult',
        tool: 'np_kb_list',
        output: expect.stringContaining('[error]'),
      },
    ]);
    // The model was offered exactly our tool and saw its (refused) result.
    const first = model.bodies[0] as {
      tools?: { function: { name: string } }[];
    };
    expect(first.tools?.map((tool) => tool.function.name)).toEqual([
      'np_kb_list',
    ]);
    expect(model.bodies.length).toBeGreaterThanOrEqual(2);
    const usage = await engine!.usage({
      userId: client.userId,
      sessionId,
      since,
    });
    expect(usage).toMatchObject({ reported: true });
    expect(usage.inputTokens).toBeGreaterThan(0);
  }, 60_000);
});
