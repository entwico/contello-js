import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type ProjectConfig = {
  url: string;
  project: string;
  token: string;
  documents: string | string[];
  output: string;
  namespace?: string | undefined;
};

export type ContelloConfig = {
  projects: ProjectConfig[];
};

const CONFIG_NAMES = ['contello.config.ts', 'contello.config.js', 'contello.config.mjs'];

export async function loadConfig(cwd: string): Promise<ContelloConfig> {
  for (const name of CONFIG_NAMES) {
    const configPath = resolve(cwd, name);

    try {
      const mod = await import(pathToFileURL(configPath).href);
      const config = mod.default ?? mod;

      if (!config.projects || !Array.isArray(config.projects)) {
        throw new Error(`${name}: expected "projects" to be an array`);
      }

      for (const [i, project] of config.projects.entries()) {
        if (!project.url) throw new Error(`${name}: projects[${i}].url is required`);
        if (!project.project) throw new Error(`${name}: projects[${i}].project is required`);
        if (!project.token) throw new Error(`${name}: projects[${i}].token is required`);
        if (!project.documents) throw new Error(`${name}: projects[${i}].documents is required`);
        if (!project.output) throw new Error(`${name}: projects[${i}].output is required`);
      }

      return config as ContelloConfig;
    } catch (e: any) {
      if (e.code === 'ERR_MODULE_NOT_FOUND' || e.code === 'ENOENT') {
        continue;
      }

      throw e;
    }
  }

  throw new Error(`no config file found (tried: ${CONFIG_NAMES.join(', ')})`);
}
