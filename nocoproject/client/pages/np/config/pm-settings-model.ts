import { readDefaultProcess } from '../api-iter4.js';
import type { WorkspaceSettings } from '../types.js';
import type { DefaultProcess } from '../types-iter4.js';

/** 设置 → 通用, iteration 4 (§A, §C): the fields as the form edits them. */
export interface PmSettingsDraft {
  readonly defaultProcess: DefaultProcess;
  readonly pmAgentId: string | null;
}

/** The iteration 4 settings as the form edits them; missing values read as the contract's defaults. */
export function pmSettingsDraft(settings: WorkspaceSettings): PmSettingsDraft {
  return {
    defaultProcess: readDefaultProcess(settings.defaultProcess),
    pmAgentId:
      typeof settings.pmAgentId === 'string' && settings.pmAgentId
        ? settings.pmAgentId
        : null,
  };
}

export function pmSettingsInput(draft: PmSettingsDraft): PmSettingsDraft {
  return { ...draft };
}
