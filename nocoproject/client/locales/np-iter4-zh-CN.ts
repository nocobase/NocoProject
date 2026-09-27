import type { NpIter4Resource } from './np-iter4-en-US.js';

/** Chinese wording for the iteration 4 groups (`docs/phase1/iteration-4-contract.md`); merged into `np` by `zh-CN.ts`. */
const npIter4ZhCN: NpIter4Resource = {
  agentForm: {
    title: '新建 Agent',
    description: '一个 Agent 在你的某个运行时上使用一种编码工具。',
    name: '名称',
    nameRequired: '请输入名称。',
    descriptionLabel: '简介',
    instructions: '指令',
    instructionsPlaceholder:
      '这个 Agent 是谁、应当如何工作。每次运行都会带上。',
    instructionsRequired: '请输入指令。',
    runtime: '运行时',
    runtimePlaceholder: '选择运行时',
    runtimeRequired: '请选择运行时。',
    noRuntimes: '还没有连接任何运行时。',
    provider: '工具',
    providerPlaceholder: '由运行时决定',
    model: '模型',
    maxConcurrentRuns: '最大并发运行数',
    maxInvalid: '请输入 1 到 100 之间的整数。',
    created: '已创建 Agent {{name}}',
    kind: '类型',
    kindHint: '项目经理只回答问题、写总结，不执行任务。',
    kinds: {
      coder: '编码',
      manager: '项目经理',
    },
    reasoningEffort: '推理强度',
    reasoningDefault: '默认',
    efforts: {
      minimal: '最低',
      low: '低',
      medium: '中',
      high: '高',
      max: '最高',
    },
    managerNotExecutor: '项目经理不能执行任务。',
  },
  newIssue: {
    title: '新建任务',
    tabsLabel: '创建方式',
    tabs: {
      ai: 'AI 整理',
      manual: '手动',
    },
    requirementLabel: '需求',
    requirementPlaceholder: '描述需求，或粘贴需求清单、会议纪要',
    parse: '整理',
    parsing: '整理中…',
  },
  process: {
    label: '流程',
    choices: {
      auto: '自动',
      direct: '直接开发',
      design_first: '先出方案',
    },
    hint: '先出方案：Agent 先分析并提交方案，你批准后再开发。',
    badge: '先出方案',
    locked: '只有待规划或待处理的任务能改流程。',
  },
  proposal: {
    tag: '方案',
    missing: '这个任务上还没有方案全文。',
    summary: '方案摘要',
  },
  retrospective: {
    tag: '总结',
  },
  pm: {
    title: '项目经理',
    description: '跨项目回答进展、任务和度量问题，任务完成后写总结。',
    emptyTitle: '还没有项目经理',
    emptyDescription:
      '项目经理是一个类型为「项目经理」的 Agent，在工作区设置里指定。',
    openSettings: '前往设置',
    loadFailed: '无法打开与项目经理的对话',
    placeholder: '问问项目经理…',
  },
  pmSettings: {
    agent: '项目经理 Agent',
    agentHint: '只列出类型为项目经理的 Agent。',
    none: '不设置',
    retrospective: '任务完成后自动总结',
    retrospectiveHint:
      'Agent 执行的任务进入已完成后，项目经理在任务上写一条内部备注。',
    defaultProcess: '默认流程',
    defaultProcessHint: '新建任务没有选择流程时使用。自动：按标题和描述判断。',
  },
};

export default npIter4ZhCN;
