import { beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { configPath, dozzzeHome, keystorePath, pidPath, logPath } from '../src/paths.js';

describe('paths', () => {
  beforeEach(() => {
    delete process.env['DOZZZE_HOME'];
  });

  it('falls back to ~/.dozzze when DOZZZE_HOME unset', () => {
    const home = dozzzeHome();
    expect(home).toMatch(/\.dozzze$/);
  });

  it('honors DOZZZE_HOME when set', () => {
    const base = join('/tmp', 'dozzze-test');
    process.env['DOZZZE_HOME'] = base;
    expect(dozzzeHome()).toBe(base);
    expect(configPath()).toBe(join(base, 'config.json'));
    expect(keystorePath()).toBe(join(base, 'keystore.json'));
    expect(pidPath()).toBe(join(base, 'dozzze.pid'));
    expect(logPath()).toBe(join(base, 'dozzze.log'));
  });

  it('ignores blank DOZZZE_HOME', () => {
    process.env['DOZZZE_HOME'] = '   ';
    expect(dozzzeHome()).toMatch(/\.dozzze$/);
  });
});
