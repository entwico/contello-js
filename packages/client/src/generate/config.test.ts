import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { loadConfig } from './config';

const dirs: string[] = [];

async function makeConfigDir(fileName: string, contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'contello-config-'));

  dirs.push(dir);
  await writeFile(join(dir, fileName), contents);

  return dir;
}

const validProject = `{
  url: 'http://localhost',
  project: 'p',
  token: 't',
  documents: 'src/**/*.gql',
  output: 'src/gen.ts',
}`;

afterEach(async () => {
  const pending = [...dirs];

  dirs.length = 0;

  await Promise.all(pending.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('loadConfig', () => {
  test('loads a default-exported config', async () => {
    const dir = await makeConfigDir(
      'contello.config.mjs',
      `export default { projects: [${validProject}] };`,
    );

    const config = await loadConfig(dir);

    expect(config.projects).toHaveLength(1);
    expect(config.projects[0]!.url).toBe('http://localhost');
  });

  test('loads a config exposed via named exports (no default)', async () => {
    const dir = await makeConfigDir(
      'contello.config.mjs',
      `export const projects = [${validProject}];`,
    );

    const config = await loadConfig(dir);

    expect(config.projects[0]!.project).toBe('p');
  });

  test('throws when projects is not an array', async () => {
    const dir = await makeConfigDir('contello.config.mjs', `export default { projects: {} };`);

    await expect(loadConfig(dir)).rejects.toThrow(/expected "projects" to be an array/);
  });

  test('throws when a required project field is missing', async () => {
    const dir = await makeConfigDir(
      'contello.config.mjs',
      `export default { projects: [{ project: 'p', token: 't', documents: 'd', output: 'o' }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(/projects\[0\]\.url is required/);
  });

  test('reports the index of the offending project', async () => {
    const dir = await makeConfigDir(
      'contello.config.mjs',
      `export default { projects: [${validProject}, { url: 'u', project: 'p', token: 't', documents: 'd' }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(/projects\[1\]\.output is required/);
  });

  test('throws when no config file exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'contello-config-empty-'));

    dirs.push(dir);

    await expect(loadConfig(dir)).rejects.toThrow(/no config file found/);
  });
});
