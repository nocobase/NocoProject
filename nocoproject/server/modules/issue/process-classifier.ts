/**
 * The process classifier (docs/phase1/iteration-4-contract.md §B): does a new issue start with analysis and a design
 * proposal a human reviews (`design_first`), or go straight to implementation (`direct`)?
 *
 * Heuristic first, in this order:
 *
 * | rule               | result       | when                                                                          |
 * | ------------------ | ------------ | ----------------------------------------------------------------------------- |
 * | `long_description` | design_first | the description has at least 600 characters                                   |
 * | `fix_prefix`       | direct       | the title starts with fix / hotfix / bugfix / typo / 修复 / 改文案, description < 200 |
 * | `keyword`          | design_first | 设计 / 方案 / 架构 / 重构 / 迁移 / 新模块 / 调研, or design / architecture / refactor / migrate / new module / research / investigate / RFC / spike |
 * | `subtasks`         | design_first | 子任务 / 拆分 / 分解 / subtask / break down, or at least three list items in the description |
 * | (none)             | direct       | nothing matched                                                               |
 *
 * NP-186: the model call is gone (it went with the AI intake parser); the manual form's `auto` is the heuristic only,
 * and the project manager names `process` explicitly when it creates a task.
 */
import type { IssueProcess } from '../shared/protocol.js';

const LONG_DESCRIPTION = 600;
const SHORT_DESCRIPTION = 200;

export interface ProcessClassifyInput {
  readonly title: string;
  readonly description: string;
}

export type ProcessRule =
  | 'long_description'
  | 'fix_prefix'
  | 'keyword'
  | 'subtasks'
  | 'short_description';

export interface HeuristicDecision {
  readonly process: IssueProcess;
  /** The rule that decided, or null when nothing matched (then the default `direct`). */
  readonly rule: ProcessRule | null;
}

export interface ProcessDecision {
  readonly process: IssueProcess;
  /** `ai` only on activity from before NP-186. */
  readonly by: 'heuristic';
  readonly rule: ProcessRule | null;
}

const FIX_PREFIX =
  /^\s*(?:\[?(?:fix(?:es|ed)?|hotfix|bugfix|typo)\b|修复|改文案)/iu;
const CHINESE_KEYWORDS = [
  '设计',
  '方案',
  '架构',
  '重构',
  '迁移',
  '新模块',
  '调研',
];
const ENGLISH_KEYWORDS =
  /\b(?:design|architecture|architect|refactor(?:ing)?|migrat(?:e|es|ion|ions)|new module|research|investigat\w*|rfc|spike)\b/iu;
const SUBTASK_WORDS =
  /子任务|拆分|分解|\bsub-?tasks?\b|\bbreak (?:it )?down\b/iu;
const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)、]|[a-z][.)])\s+\S/u;

function listItems(text: string): number {
  return text.split(/\r?\n/u).filter((line) => LIST_ITEM.test(line)).length;
}

/** The heuristic alone (pure). */
export function classifyHeuristic(
  input: ProcessClassifyInput,
): HeuristicDecision {
  const title = input.title ?? '';
  const description = input.description ?? '';
  const text = `${title}\n${description}`;
  if (description.length >= LONG_DESCRIPTION)
    return { process: 'design_first', rule: 'long_description' };
  if (FIX_PREFIX.test(title) && description.length < SHORT_DESCRIPTION)
    return { process: 'direct', rule: 'fix_prefix' };
  if (
    CHINESE_KEYWORDS.some((word) => text.includes(word)) ||
    ENGLISH_KEYWORDS.test(text)
  )
    return { process: 'design_first', rule: 'keyword' };
  if (SUBTASK_WORDS.test(text) || listItems(description) >= 3)
    return { process: 'design_first', rule: 'subtasks' };
  // A short brief with no design signal is routine work; asking the model would only add latency and doubt.
  if (description.length < SHORT_DESCRIPTION)
    return { process: 'direct', rule: 'short_description' };
  return { process: 'direct', rule: null };
}

export interface ProcessClassifier {
  /** The heuristic (never throws). */
  classify(input: ProcessClassifyInput): Promise<ProcessDecision>;
}

export function createProcessClassifier(): ProcessClassifier {
  return {
    async classify(input) {
      return { ...classifyHeuristic(input), by: 'heuristic' };
    },
  };
}
