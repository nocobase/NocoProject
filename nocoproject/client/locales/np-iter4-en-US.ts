import type { LocaleResource } from '@nocobase/i18n';

/**
 * NocoProject wording added in Phase 1 iteration 4 (`docs/phase1/iteration-4-contract.md`): the unified "new issue"
 * dialog, the design-first process, the project manager page and settings, and the agent form (moved here from
 * `en-US.ts` when it gained the kind and reasoning effort). Merged into `np` by `en-US.ts` after the design groups;
 * every group is new there, so the spread never shadows an earlier one. `np-iter4-zh-CN.ts` is checked against the
 * shape derived from this object.
 */
const npIter4EnUS = {
  agentForm: {
    title: 'New agent',
    description: 'An agent runs one coding tool on one of your runtimes.',
    name: 'Name',
    nameRequired: 'Enter a name.',
    descriptionLabel: 'Description',
    instructions: 'Instructions',
    instructionsPlaceholder:
      'Who this agent is and how it should work. Included in every run.',
    instructionsRequired: 'Enter the instructions.',
    runtime: 'Runtime',
    runtimePlaceholder: 'Choose a runtime',
    runtimeRequired: 'Choose a runtime.',
    noRuntimes: 'No runtime is connected yet.',
    provider: 'Provider',
    providerPlaceholder: 'From the runtime',
    model: 'Model',
    maxConcurrentRuns: 'Max concurrent runs',
    maxInvalid: 'Enter a whole number from 1 to 100.',
    created: 'Agent {{name}} created',
    kind: 'Kind',
    kindHint:
      'A project manager answers questions and writes retrospectives; it never executes issues.',
    kinds: {
      coder: 'Coding',
      manager: 'Project manager',
    },
    reasoningEffort: 'Reasoning effort',
    reasoningDefault: 'Default',
    efforts: {
      minimal: 'Minimal',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      max: 'Max',
    },
    managerNotExecutor: 'A project manager cannot execute issues.',
  },
  newIssue: {
    title: 'New issue',
    tabsLabel: 'How to create',
    tabs: {
      ai: 'AI draft',
      manual: 'Manual',
    },
    requirementLabel: 'Requirements',
    requirementPlaceholder:
      'Describe what is needed, or paste a requirements list or meeting notes',
    parse: 'Draft issues',
    parsing: 'Drafting…',
  },
  process: {
    label: 'Process',
    choices: {
      auto: 'Automatic',
      direct: 'Straight to development',
      design_first: 'Design first',
    },
    hint: 'Design first: the agent analyses and submits a proposal; development starts once you approve it.',
    badge: 'Design first',
    locked:
      'The process can only change while the issue is in backlog or todo.',
  },
  proposal: {
    tag: 'Proposal',
    missing: 'The proposal text is not on this issue yet.',
    summary: 'Proposal summary',
  },
  retrospective: {
    tag: 'Retrospective',
  },
  pm: {
    title: 'Project manager',
    description:
      'Answers questions about progress, issues and metrics across projects, and writes a retrospective when an issue is done.',
    emptyTitle: 'No project manager yet',
    emptyDescription:
      'The project manager is an agent of the project manager kind, chosen in the workspace settings.',
    openSettings: 'Open settings',
    loadFailed: 'Unable to open the conversation with the project manager',
    placeholder: 'Ask the project manager…',
  },
  attachments: {
    title: 'Attachments',
    upload: 'Upload',
    choose: 'Choose, drop or paste files',
    preview: 'Preview',
    download: 'Download',
    remove: 'Remove',
    retry: 'Retry',
    attachTo: 'Attach to',
    added: 'Attachments added',
    removed: 'Attachment removed',
    removeTitle: 'Remove {{filename}}?',
    removeDescription:
      'The file is deleted for everyone who can see this issue.',
    tooLarge: 'The file is larger than the upload limit.',
    uploadFailed: 'Upload failed.',
    stillUploading: 'Attachments are still uploading.',
    fixFailed: 'An attachment failed to upload. Retry or remove it.',
    invalid:
      'An attachment can no longer be used. Remove it and upload it again.',
  },
  pmSettings: {
    agent: 'Project manager agent',
    agentHint: 'Only agents of the project manager kind are listed.',
    none: 'None',
    retrospective: 'Retrospective when an issue is done',
    retrospectiveHint:
      'When an issue an agent executed moves to done, the project manager writes an internal note on it.',
    defaultProcess: 'Default process',
    defaultProcessHint:
      'Used when a new issue does not choose one. Automatic decides from the title and description.',
  },
};

export default npIter4EnUS;
export type NpIter4Resource = LocaleResource<typeof npIter4EnUS>;
