import {
  defineAppConfig,
  envString,
  type AppConfigFactory,
} from '@nocobase/app-server/config';

/**
 * NocoProject's own configuration section (docs/phase1/iteration-2-contract.md §B). `secretKey` encrypts stored
 * secrets (GitHub token, webhook secret, agent environment variables); see `server/modules/shared/crypto.ts`. Set it
 * with `NOCOPROJECT_SECRET_KEY` (64 hex characters or base64 of 32 bytes) or `nocoproject.secretKey` in config.yml.
 * Without it a development key is derived from `auth.secret` and a warning is logged.
 */
export interface NocoProjectConfig {
  readonly secretKey?: string;
}

const nocoproject: AppConfigFactory<NocoProjectConfig> = defineAppConfig({
  env: { NOCOPROJECT_SECRET_KEY: envString('secretKey') },
  defaults: () => ({}),
});

export default nocoproject;
