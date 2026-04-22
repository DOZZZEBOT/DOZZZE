// Tiny pidfile helper for `dozzze start` / `dozzze stop`. Cross-platform.
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ensureHome, pidPath } from './paths.js';

/** Writes the current process PID to the pidfile. */
export async function writePid(): Promise<void> {
  await ensureHome();
  await writeFile(pidPath(), String(process.pid), 'utf8');
}

/** Reads the PID from the pidfile, or null if missing/malformed. */
export async function readPid(): Promise<number | null> {
  const path = pidPath();
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf8');
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Removes the pidfile if present. */
export async function clearPid(): Promise<void> {
  try {
    await unlink(pidPath());
  } catch {
    /* already gone */
  }
}

/** Returns true if a process with the given PID is currently alive. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Sends SIGTERM to the given PID. Returns true if the signal was delivered. */
export function sendStop(pid: number): boolean {
  try {
    // SIGTERM on POSIX; on Windows, Node treats this as a hard kill for the target.
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}
