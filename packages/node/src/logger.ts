// Terminal logger with a bit of personality. No emoji spam, ASCII symbols only.

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
} as const;

type Color = keyof typeof ANSI;

function paint(text: string, color: Color): string {
  if (!process.stdout.isTTY) return text;
  return `${ANSI[color]}${text}${ANSI.reset}`;
}

function ts(): string {
  const d = new Date();
  return d.toISOString().slice(11, 19);
}

/** Logs a neutral informational line. */
export function info(msg: string): void {
  process.stdout.write(`${paint(ts(), 'dim')} ${paint('▸', 'cyan')} ${msg}\n`);
}

/** Logs a success. Use for "good" state transitions. */
export function ok(msg: string): void {
  process.stdout.write(`${paint(ts(), 'dim')} ${paint('●', 'green')} ${msg}\n`);
}

/** Logs a soft warning — not fatal, but worth flagging. */
export function warn(msg: string): void {
  process.stdout.write(`${paint(ts(), 'dim')} ${paint('⚠', 'yellow')} ${msg}\n`);
}

/** Logs an error. Writes to stderr. */
export function err(msg: string): void {
  process.stderr.write(`${paint(ts(), 'dim')} ${paint('×', 'red')} ${msg}\n`);
}

/** Logs a debug line, gated on DOZZZE_DEBUG=1. */
export function debug(msg: string): void {
  if (process.env['DOZZZE_DEBUG'] !== '1') return;
  process.stdout.write(`${paint(ts(), 'dim')} ${paint('·', 'magenta')} ${paint(msg, 'dim')}\n`);
}

/** Logs a banner used at startup. */
export function banner(lines: string[]): void {
  for (const line of lines) process.stdout.write(`${paint(line, 'bold')}\n`);
}

/** Emphasizes a value inline (for use inside other messages). */
export function em(s: string): string {
  return paint(s, 'bold');
}

/** Dims inline (for use inside other messages). */
export function dim(s: string): string {
  return paint(s, 'dim');
}
