import { describe, expect, it, vi } from 'vitest';
import { makeMockJob, startMockCoordinator } from '../src/coordinator-mock.js';
import { parseJob, PROTOCOL_VERSION } from '../src/protocol.js';

describe('coordinator-mock', () => {
  it('makeMockJob produces a schema-valid Job', () => {
    const j = makeMockJob('llama3.2');
    const parsed = parseJob(j);
    expect(parsed.model).toBe('llama3.2');
    expect(parsed.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(parsed.prompt.length).toBeGreaterThan(0);
  });

  it('startMockCoordinator fires jobs at the given interval', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const stop = startMockCoordinator({
      intervalMs: 1000,
      onJob: (j) => {
        seen.push(j.id);
      },
    });

    await vi.advanceTimersByTimeAsync(3500);
    stop();
    // 3 full ticks fire within 3.5 seconds.
    expect(seen.length).toBe(3);
    vi.useRealTimers();
  });
});
