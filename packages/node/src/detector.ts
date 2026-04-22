// Probes localhost for Ollama (:11434) and LM Studio (:1234) and reports
// whether they are running, plus what models are available.

import { z } from 'zod';

const OllamaTagsSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        size: z.number().optional(),
        modified_at: z.string().optional(),
      }),
    )
    .default([]),
});

const LmStudioModelsSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        object: z.string().optional(),
      }),
    )
    .default([]),
});

export interface DetectedRuntime {
  name: 'ollama' | 'lm-studio';
  url: string;
  running: boolean;
  models: string[];
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 1500;

/**
 * Fetch with an explicit AbortController + cleared timer on both code paths.
 * Avoids leaking a pending network handle at process exit (Node 24 + libuv on
 * Windows trips an assertion when any socket is still open on shutdown).
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Probes an Ollama instance. Never throws — returns `running: false` on error. */
export async function detectOllama(
  url = 'http://127.0.0.1:11434',
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DetectedRuntime> {
  const result: DetectedRuntime = {
    name: 'ollama',
    url,
    running: false,
    models: [],
  };
  try {
    const res = await fetchWithTimeout(`${url}/api/tags`, timeoutMs);
    if (!res.ok) {
      result.error = `HTTP ${res.status}`;
      return result;
    }
    const json: unknown = await res.json();
    const parsed = OllamaTagsSchema.safeParse(json);
    if (!parsed.success) {
      result.error = 'Response did not match expected shape';
      return result;
    }
    result.running = true;
    result.models = parsed.data.models.map((m) => m.name);
    return result;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    return result;
  }
}

/** Probes an LM Studio OpenAI-compatible server. Never throws. */
export async function detectLmStudio(
  url = 'http://127.0.0.1:1234',
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DetectedRuntime> {
  const result: DetectedRuntime = {
    name: 'lm-studio',
    url,
    running: false,
    models: [],
  };
  try {
    const res = await fetchWithTimeout(`${url}/v1/models`, timeoutMs);
    if (!res.ok) {
      result.error = `HTTP ${res.status}`;
      return result;
    }
    const json: unknown = await res.json();
    const parsed = LmStudioModelsSchema.safeParse(json);
    if (!parsed.success) {
      result.error = 'Response did not match expected shape';
      return result;
    }
    result.running = true;
    result.models = parsed.data.data.map((m) => m.id);
    return result;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    return result;
  }
}

/** Probes every supported runtime in parallel. */
export async function detectAll(opts?: {
  ollamaUrl?: string;
  lmStudioUrl?: string;
  timeoutMs?: number;
}): Promise<DetectedRuntime[]> {
  const [ollama, lm] = await Promise.all([
    detectOllama(opts?.ollamaUrl, opts?.timeoutMs),
    detectLmStudio(opts?.lmStudioUrl, opts?.timeoutMs),
  ]);
  return [ollama, lm];
}
