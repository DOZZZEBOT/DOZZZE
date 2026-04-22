// `dozzze config` — show / get / set / path for ~/.dozzze/config.json.
import { configExists, defaultConfig, loadConfig, patchConfig } from '../config.js';
import { configPath } from '../paths.js';
import * as log from '../logger.js';

/** Entry point for the config subcommand. */
export async function configCmd(
  action: string,
  key: string | undefined,
  value: string | undefined,
): Promise<void> {
  switch (action) {
    case 'path':
      process.stdout.write(`${configPath()}\n`);
      return;
    case 'show': {
      const cfg = configExists() ? await loadConfig() : defaultConfig();
      process.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
      return;
    }
    case 'get': {
      if (!key) throw new Error('usage: dozzze config get <key>');
      const cfg = configExists() ? await loadConfig() : defaultConfig();
      const v = getNested(cfg as unknown as Record<string, unknown>, key);
      process.stdout.write((typeof v === 'string' ? v : JSON.stringify(v)) + '\n');
      return;
    }
    case 'set': {
      if (!key || value === undefined) throw new Error('usage: dozzze config set <key> <value>');
      const parsed = coerceValue(value);
      const updated = await patchConfig({ [key]: parsed } as Record<string, unknown>);
      log.ok(`set ${key} = ${JSON.stringify((updated as Record<string, unknown>)[key])}`);
      return;
    }
    default:
      throw new Error(`unknown action: ${action}. Try show|get|set|path.`);
  }
}

function getNested(obj: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

/** Best-effort type coercion: numbers, booleans, JSON literals, else raw string. */
function coerceValue(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}
