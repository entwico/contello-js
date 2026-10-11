import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliPath = resolve(import.meta.dirname, '../dist/cli.js');

type Result = { code: number; stdout: string; stderr: string };

async function runCli(args: string[], cwd: string): Promise<Result> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], { cwd });

    return { code: 0, stdout, stderr };
  } catch (error: any) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

// exercises the built bundle: the generate command lives in a lazily imported chunk
// that must survive the bundler's tree-shaking of this side-effect-free package
describe.skipIf(!existsSync(cliPath))('built cli', () => {
  let cwd: string;

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), 'contello-client-cli-'));
  });

  afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('prints usage and fails without a command', async () => {
    const result = await runCli([], cwd);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('usage: contello-client <command>');
  });

  it('generate fails loudly without a config file', async () => {
    const result = await runCli(['generate'], cwd);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no config file found');
  });
});
