import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { detectOllama, detectLmStudio, detectAll } from '../src/detector.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('detector', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('ollama: reports models on happy path', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ models: [{ name: 'llama3.2' }, { name: 'qwen2.5' }] }),
    );
    const r = await detectOllama('http://127.0.0.1:11434', 500);
    expect(r.running).toBe(true);
    expect(r.models).toEqual(['llama3.2', 'qwen2.5']);
  });

  it('ollama: flags down when fetch throws', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const r = await detectOllama('http://127.0.0.1:11434', 500);
    expect(r.running).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });

  it('ollama: flags down on non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const r = await detectOllama('http://127.0.0.1:11434', 500);
    expect(r.running).toBe(false);
    expect(r.error).toBe('HTTP 500');
  });

  it('ollama: tolerates empty models array', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}));
    const r = await detectOllama('http://127.0.0.1:11434', 500);
    expect(r.running).toBe(true);
    expect(r.models).toEqual([]);
  });

  it('lm-studio: reports models on happy path', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'phi-3' }] }));
    const r = await detectLmStudio('http://127.0.0.1:1234', 500);
    expect(r.running).toBe(true);
    expect(r.models).toEqual(['phi-3']);
  });

  it('detectAll runs both in parallel', async () => {
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('11434')) return jsonResponse({ models: [{ name: 'llama3.2' }] });
      if (url.includes('1234')) return jsonResponse({ data: [{ id: 'phi-3' }] });
      return new Response('404', { status: 404 });
    });
    const all = await detectAll();
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.name === 'ollama')?.running).toBe(true);
    expect(all.find((r) => r.name === 'lm-studio')?.running).toBe(true);
  });
});
