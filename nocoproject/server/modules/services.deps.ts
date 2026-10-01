/**
 * What `createNpServices` (`services.ts`) is built from: the database and id generator, and the injectable edges the
 * provider backs with plugins and the tests replace with doubles.
 */
import type { DatabaseManager } from '@nocobase/db';
import type { IdGeneratorService } from '@nocobase/snowflake';

import type { AttachmentTextReader } from './attachment/attachment-text.js';
import type { FileObjectStore } from './attachment/attachment.service.js';
import type { BuiltinEngineSource } from './builtin/builtin.engine.js';
import type {
  BuiltinExecutorConfig,
  BuiltinExecutorDeps,
} from './builtin/builtin.executor.js';
import type { AgentApi } from './builtin/builtin.toolbox.js';
import type { ComputerKeys } from './computer/computer.service.js';
import type { GitHubClient } from './git/github-client.js';
import type { AiIntakeParser } from './intake/ai-parser.js';
import type { AiProcessClassifier } from './intake/process-classifier.js';
import type { InvitationMailer } from './member/invitation.mail.js';
import type { InvitationAccounts } from './member/invitation.service.js';
import type { RoleAssignments, RoleStore } from './member/member.roles.js';
import type { BuiltinAiSource } from './runtime/builtin-ai.js';
import type { ApprovalGateway, ApprovalHooks } from './shared/approval.js';
import type { SecretBox } from './shared/crypto.js';
import type { TxRunner } from './shared/db.js';
import type { DomainEventBus } from './shared/events.js';

/** What an alternative approval gateway gets to build itself (tests: the in-memory double). */
export interface ApprovalGatewayContext {
  readonly tx: TxRunner;
  readonly hooks: () => ApprovalHooks;
}

export interface NpServiceDeps {
  readonly database: DatabaseManager;
  readonly idGenerator: IdGeneratorService;
  readonly bus?: DomainEventBus;
  /** Defaults to a random process-local key (tests); the provider passes the configured one. */
  readonly secrets?: SecretBox;
  /** Defaults to the fetch-based client. */
  readonly github?: GitHubClient;
  /** The AI intake parser; null or absent = heuristic only. */
  readonly aiIntake?: AiIntakeParser | null;
  /** Whether an LLM service is configured (`ai.llmServices` not empty). */
  readonly aiConfigured?: () => boolean | Promise<boolean>;
  /** Iteration 4: the AI process classifier; null or absent = heuristic only. */
  readonly aiProcess?: AiProcessClassifier | null;
  /** NP-78: deletes stored attachment objects; the provider backs it with Drive. Absent = objects are kept (tests). */
  readonly fileObjects?: FileObjectStore;
  readonly onFileObjectError?: (error: unknown) => void;
  /** NP-78: reads files attached on the AI draft tab (np.newIssue.tabs.ai) for the AI parser; absent = files are not read. */
  readonly attachmentText?: AttachmentTextReader | null;
  /** NP-214: the application's base path, prefixed to the `contentUrl` of comment files. Absent = none (tests). */
  readonly contentBasePath?: () => string;
  /** NP-88: invitation email and account creation; absent = no email is sent, no account can be created. */
  readonly mailer?: () => InvitationMailer;
  readonly accounts?: () => InvitationAccounts | null;
  /** NP-150: the computer credential store; the provider backs it with the API Keys plugin. Absent = none can be issued. */
  readonly computerKeys?: () => ComputerKeys;
  /**
   * NP-117: where member roles are stored. The provider backs it with the built-in permission sets; the service tests
   * pass a double over `members.role`.
   */
  readonly roles: () => RoleAssignments;
  /**
   * NP-153: the permission sets behind the business roles of `/config/members`. Absent (service tests) = role
   * management answers 409 `ROLES_UNAVAILABLE`.
   */
  readonly roleStore?: () => RoleStore;
  /**
   * NP-219: the AI plugin's LLM services, for built-in runtimes and agents (`runtime/builtin-ai.ts`); the provider
   * backs it with the plugin's `aiManagerToken`. Absent = the plugin is not registered.
   */
  readonly builtinAi?: BuiltinAiSource;
  /** NP-219: the AI plugin's agent runs and the in-process agent API for built-in runs; absent = none run. */
  readonly builtinEngine?: BuiltinEngineSource;
  readonly agentApi?: () => AgentApi;
  readonly builtinConfig?: Partial<BuiltinExecutorConfig>;
  /** Tests: shorter lease and cancellation timers. */
  readonly builtinTimers?: BuiltinExecutorDeps['timers'];
  readonly onBuiltinError?: (error: unknown, message: string) => void;
  /** Replaces the database approval gateway (the replacement checklist test). */
  readonly approvalGateway?: (
    context: ApprovalGatewayContext,
  ) => ApprovalGateway;
}
