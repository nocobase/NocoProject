/**
 * In-process mock of the NocoProject server: daemon API (§4), agent API (§5) and the
 * NocoBase realtime socket at <base>/ws. Records every call for assertions.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClaimedRun, CommentForAgent, IssueForAgent, RunStatus } from '../../src/protocol.js';

export const API_KEY = 'test-api-key-0123456789';
export const BASE = '/main';

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: any;
  readonly auth: string | undefined;
}

interface RunState {
  status: RunStatus;
  cancelRequested: boolean;
  claimed: ClaimedRun;
  events: any[];
}

export interface MockOptions {
  readonly startDelayMs?: number;
  readonly wsAuth?: boolean;
  readonly protocolMismatch?: boolean;
}

const TRANSITIONS = [
  { from: 'todo', to: 'in_progress' },
  { from: 'blocked', to: 'in_progress' },
  { from: 'in_progress', to: 'in_review' },
  { from: 'in_progress', to: 'blocked' },
];

export class MockServer {
  readonly calls: Call[] = [];
  readonly issues = new Map<string, IssueForAgent>();
  readonly comments = new Map<string, CommentForAgent[]>();
  readonly runs = new Map<string, RunState>();
  readonly queue: ClaimedRun[] = [];
  readonly tokens = new Map<string, string>();
  readonly runtimes = new Map<string, { id: string; provider: string }>();
  private readonly sockets = new Set<WebSocket>();
  private server: Server;
  private wss: WebSocketServer;
  private seq = 100;
  url = '';

  constructor(private readonly opts: MockOptions = {}) {
    this.server = createServer((req, res) => void this.handle(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (req, socket, head) => {
      if (req.url !== `${BASE}/ws` || req.headers['x-api-key'] !== API_KEY) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws));
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}${BASE}`;
  }

  async stop(): Promise<void> {
    for (const ws of this.sockets) ws.terminate();
    this.wss.close();
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  get subscribers(): number {
    return this.sockets.size;
  }

  private onSocket(ws: WebSocket): void {
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { type: string; id?: string; topic?: string };
      if (msg.type === 'subscribe') {
        if (this.opts.wsAuth === false) {
          ws.send(JSON.stringify({ type: 'error', code: 'AUTHENTICATION_REQUIRED', message: 'Realtime topic "np:daemon" requires authentication.' }));
          return;
        }
        this.sockets.add(ws);
        ws.send(JSON.stringify({ type: 'subscribed', id: msg.id, topic: msg.topic, subscriptionId: 'sub-1' }));
      } else if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', id: msg.id }));
    });
    ws.on('close', () => this.sockets.delete(ws));
  }

  publish(payload: unknown): void {
    const frame = JSON.stringify({ type: 'event', topic: 'np:daemon', payload, publishedAt: new Date().toISOString() });
    for (const ws of this.sockets) ws.send(frame);
  }

  addIssue(partial: Partial<IssueForAgent> & { id: string; identifier: string }): IssueForAgent {
    const issue: IssueForAgent = {
      title: 'Test issue',
      description: 'Do the thing.',
      statusKey: 'todo',
      priority: 'medium',
      ownerName: 'Alice',
      executor: { type: 'agent', id: 'agent-1', name: 'Echo Bot' },
      ...partial,
    };
    this.issues.set(issue.id, issue);
    this.comments.set(issue.id, this.comments.get(issue.id) ?? []);
    return issue;
  }

  /** Queues a run for the given issue and publishes `workAvailable`. */
  enqueue(issueId: string, opts: { provider?: string; triggerComment?: string; session?: ClaimedRun['session'] } = {}): string {
    const issue = this.issues.get(issueId);
    if (!issue) throw new Error(`no issue ${issueId}`);
    const provider = opts.provider ?? 'echo';
    const runtime = [...this.runtimes.values()].find((r) => r.provider === provider);
    const runId = String(++this.seq);
    const triggers: ClaimedRun['triggers'] = opts.triggerComment
      ? [{ type: 'mention', comment: this.addHumanComment(issueId, opts.triggerComment) }]
      : [{ type: 'assign' }];
    this.queue.push({
      run: { id: runId, agentId: 'agent-1', runtimeId: runtime?.id ?? 'rt-missing', attempt: 1, priority: 0, createdAt: new Date().toISOString() },
      token: `npr_${randomBytes(20).toString('hex')}`,
      agent: { id: 'agent-1', name: 'Echo Bot', instructions: 'Be brief.', provider: provider as any, model: null },
      issue: { id: issue.id, identifier: issue.identifier, title: issue.title, statusKey: issue.statusKey, ownerName: issue.ownerName },
      statusCatalog: [],
      agentTransitions: TRANSITIONS,
      triggers,
      session: opts.session ?? { providerSessionId: null, workDir: null, fresh: true },
      server: { url: this.url, protocolVersion: 1 },
      leaseSeconds: 45,
    });
    if (runtime) this.publish({ kind: 'workAvailable', runtimeId: runtime.id });
    return runId;
  }

  addHumanComment(issueId: string, content: string) {
    const id = `c${++this.seq}`;
    const comment: CommentForAgent = { id, authorType: 'user', authorName: 'Alice', content, parentId: null, rootId: id, createdAt: new Date().toISOString() };
    this.comments.get(issueId)?.push(comment);
    return { id, authorName: 'Alice', content, parentId: null, rootId: id };
  }

  /** Creates a running run for the issue (as if claimed) and returns its token. */
  issueToken(issueId: string): string {
    const runId = this.enqueue(issueId);
    const idx = this.queue.findIndex((q) => q.run.id === runId);
    const [run] = this.queue.splice(idx, 1);
    if (!run) throw new Error('enqueue failed');
    this.runs.set(runId, { status: 'running', cancelRequested: false, claimed: run, events: [] });
    this.tokens.set(run.token, runId);
    return run.token;
  }

  requestCancel(runId: string): void {
    const run = this.runs.get(runId);
    if (run) run.cancelRequested = true;
    this.publish({ kind: 'cancelRequested', runId });
  }

  callsTo(pattern: RegExp): Call[] {
    return this.calls.filter((c) => pattern.test(`${c.method} ${c.path}`));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.startsWith(`${BASE}/api`) ? url.pathname.slice(`${BASE}/api`.length) : url.pathname;
    const body = raw ? JSON.parse(raw) : undefined;
    const auth = (req.headers['x-api-key'] as string | undefined) ?? (req.headers.authorization as string | undefined);
    this.calls.push({ method: req.method ?? 'GET', path: `${path}${url.search}`, body, auth });
    const send = (status: number, payload: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    try {
      if (path === '/healthz') return send(200, { ok: true });
      if (path.startsWith('/np/daemon/')) return await this.daemonRoute(req.method ?? 'GET', path, body, req, send);
      if (path.startsWith('/np/agent/')) return this.agentRoute(req.method ?? 'GET', path, url, body, req, send);
      if (path === '/np/me') return req.headers['x-api-key'] === API_KEY ? send(200, { data: { userId: '1', name: 'Alice' } }) : send(401, { code: 'UNAUTHORIZED', message: 'no' });
      send(404, { code: 'NOT_FOUND', message: path });
    } catch (error) {
      send(500, { code: 'INTERNAL', message: (error as Error).message });
    }
  }

  private async daemonRoute(method: string, path: string, body: any, req: IncomingMessage, send: (s: number, p: unknown) => void): Promise<void> {
    if (req.headers['x-api-key'] !== API_KEY) return send(401, { code: 'UNAUTHORIZED', message: 'bad key' });
    if (path === '/np/daemon/register') {
      if (this.opts.protocolMismatch) return send(426, { code: 'PROTOCOL_MISMATCH', message: 'upgrade' });
      const runtimes = (body.runtimes as { provider: string }[]).map((r) => {
        const existing = this.runtimes.get(r.provider) ?? { id: `rt-${r.provider}`, provider: r.provider };
        this.runtimes.set(r.provider, existing);
        return existing;
      });
      return send(200, { data: { runtimes, serverTime: new Date().toISOString(), protocolVersion: 1, pollIntervalMs: 15000, heartbeatIntervalMs: 15000 } });
    }
    if (path === '/np/daemon/heartbeat' || path === '/np/daemon/deregister') return send(200, { data: { ok: true } });
    if (path === '/np/daemon/runs/claim') {
      const out: ClaimedRun[] = [];
      for (const slot of body.slots as { runtimeId: string; free: number }[]) {
        for (let i = 0; i < slot.free; i++) {
          const idx = this.queue.findIndex((q) => q.run.runtimeId === slot.runtimeId);
          if (idx < 0) break;
          const [run] = this.queue.splice(idx, 1);
          if (!run) break;
          this.runs.set(run.run.id, { status: 'dispatched', cancelRequested: false, claimed: run, events: [] });
          this.tokens.set(run.token, run.run.id);
          out.push(run);
        }
      }
      return send(200, { data: { runs: out } });
    }
    const m = path.match(/^\/np\/daemon\/runs\/([^/]+)\/([a-z-]+)$/);
    const run = m ? this.runs.get(m[1] as string) : undefined;
    if (!m || !run) return send(404, { code: 'RUN_NOT_FOUND', message: path });
    const action = m[2];
    if (action === 'lease') return send(200, { data: { ok: true } });
    if (action === 'start') {
      if (this.opts.startDelayMs) await new Promise((r) => setTimeout(r, this.opts.startDelayMs));
      run.status = 'running';
      return send(200, { data: { ok: true } });
    }
    if (action === 'events') {
      for (const e of body.events) if (!run.events.some((x) => x.seq === e.seq)) run.events.push(e);
      return send(200, { data: { ok: true } });
    }
    if (action === 'status') return send(200, { data: { status: run.status, cancelRequested: run.cancelRequested } });
    if (action === 'complete') run.status = 'completed';
    else if (action === 'fail') run.status = 'failed';
    else if (action === 'cancel-ack') run.status = 'cancelled';
    else return send(404, { code: 'NOT_FOUND', message: path });
    return send(200, { data: { ok: true } });
  }

  private agentRoute(method: string, path: string, url: URL, body: any, req: IncomingMessage, send: (s: number, p: unknown) => void): void {
    const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/, '');
    const runId = this.tokens.get(token);
    const run = runId ? this.runs.get(runId) : undefined;
    if (!run || ['completed', 'failed', 'cancelled'].includes(run.status)) return send(401, { code: 'INVALID_RUN_TOKEN', message: 'bad token' });
    if (path === '/np/agent/context') {
      const issue = this.issues.get(run.claimed.issue.id);
      return send(200, { data: { run: { id: runId }, agent: { id: 'agent-1', name: 'Echo Bot' }, issue, statusCatalog: [], agentTransitions: TRANSITIONS } });
    }
    const m = path.match(/^\/np\/agent\/issues\/([^/]+)(?:\/(comments|status))?$/);
    const issue = m ? this.issues.get(decodeURIComponent(m[1] as string)) : undefined;
    if (!m || !issue) return send(404, { code: 'ISSUE_NOT_FOUND', message: path });
    if (!m[2]) return send(200, { data: issue });
    if (m[2] === 'comments' && method === 'GET') return send(200, { data: this.comments.get(issue.id) ?? [] });
    if (m[2] === 'comments') {
      const id = `c${++this.seq}`;
      const parent = body.parentId ? this.comments.get(issue.id)?.find((c) => c.id === body.parentId) : undefined;
      const comment: CommentForAgent = {
        id,
        authorType: 'agent',
        authorName: 'Echo Bot',
        content: body.content,
        parentId: body.parentId ?? null,
        rootId: parent?.rootId ?? id,
        createdAt: new Date().toISOString(),
      };
      this.comments.get(issue.id)?.push(comment);
      return send(200, { data: { comment } });
    }
    const allowed = TRANSITIONS.some((t) => t.from === issue.statusKey && t.to === body.statusKey);
    if (!allowed) return send(403, { code: 'TRANSITION_NOT_ALLOWED', message: `${issue.statusKey} → ${body.statusKey}` });
    this.issues.set(issue.id, { ...issue, statusKey: body.statusKey });
    return send(200, { data: { issue: { id: issue.id, statusKey: body.statusKey } } });
  }
}
