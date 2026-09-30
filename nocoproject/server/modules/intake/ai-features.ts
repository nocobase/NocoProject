/**
 * NP-205: the two fast, direct-model features — `intakeAi` (the new issue AI draft tab, its refinement and the process
 * classifier) and `breakdownAi` (splitting an issue into sub-issues) — each with its own switch, parser and model.
 * They never run an agent: one direct model call, so a chosen model should be a quick one. The project manager
 * conversation is separate and unaffected.
 */
import type { Conn } from '../shared/db.js';
import type {
  AiFeatureEffective,
  AiFeatureKey,
  AiFeatureSetting,
  AiModelOption,
  AiModelRef,
} from '../shared/protocol.js';
import type { SettingsService } from '../system/settings.service.js';

/** The enabled models of the application's LLM services (`ai.llmServices`), in the plugin's order. */
export interface AiModelCatalog {
  list(): Promise<readonly AiModelOption[]>;
}

export const NO_AI_MODELS: AiModelCatalog = { list: async () => [] };

/**
 * The model a feature calls: the chosen one while it is still enabled, else the AI plugin's default (the first model
 * of the first service that has one). `null` = no model is configured at all.
 */
export function pickModel(
  catalog: readonly AiModelOption[],
  chosen: AiModelRef | null,
): {
  ref: AiModelRef;
  label: string;
  serviceTitle: string;
  source: 'setting' | 'default';
} | null {
  const find = (ref: AiModelRef) => {
    const service = catalog.find((item) => item.llmService === ref.llmService);
    const model = service?.models.find((item) => item.value === ref.model);
    return service && model
      ? { ref, label: model.label, serviceTitle: service.title }
      : null;
  };
  const chosenHit = chosen ? find(chosen) : null;
  if (chosenHit) return { ...chosenHit, source: 'setting' };
  const service = catalog.find((item) => item.models.length > 0);
  const first = service?.models[0];
  return service && first
    ? {
        ref: { llmService: service.llmService, model: first.value },
        label: first.label,
        serviceTitle: service.title,
        source: 'default',
      }
    : null;
}

/** What a feature uses right now, for the settings page. */
export function describeFeature(
  setting: AiFeatureSetting,
  catalog: readonly AiModelOption[],
): AiFeatureEffective {
  const picked = pickModel(catalog, setting.model);
  const model = picked
    ? {
        ...picked.ref,
        serviceTitle: picked.serviceTitle,
        label: picked.label,
      }
    : null;
  const fallback = !setting.enabled
    ? 'disabled'
    : setting.parser === 'heuristic'
      ? 'rules_only'
      : picked
        ? null
        : 'no_model';
  return {
    active: fallback === null,
    fallback,
    model,
    source: picked?.source ?? null,
  };
}

export interface AiFeatureState {
  readonly setting: AiFeatureSetting;
  /** The feature is on and may call a model (parser `auto`, and one is configured). */
  readonly useModel: boolean;
  /** The model to call; `null` lets the plugin pick its default. */
  readonly model: AiModelRef | null;
}

export async function readAiFeature(
  settings: SettingsService,
  catalog: AiModelCatalog | null,
  aiConfigured: () => boolean,
  conn: Conn,
  key: AiFeatureKey,
): Promise<AiFeatureState> {
  const setting = (await settings.read(conn))[key];
  if (!setting.enabled || setting.parser !== 'auto' || !aiConfigured())
    return { setting, useModel: false, model: null };
  if (!catalog) return { setting, useModel: true, model: setting.model };
  const picked = pickModel(await catalog.list(), setting.model);
  return { setting, useModel: !!picked, model: picked?.ref ?? null };
}
