import { afterEach, describe, expect, it } from 'vitest';
import { refreshEvery, SttCapabilityCache } from '../src/stt/capability-cache';
import { HttpSttClient } from '../src/stt/http-stt-client';
import { NO_CAPABILITIES } from '../src/stt/stt-capabilities';
import { ROUTING_MODELS, ROUTING_STT, startFakeSttServer, type FakeSttResponse, type FakeSttServer } from './support/fake-stt-server';
import { waitUntil } from './support/wait-until';

let fake: FakeSttServer | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

async function cacheFor(capabilities: FakeSttResponse = ROUTING_STT): Promise<{ cache: SttCapabilityCache; stt: FakeSttServer }> {
  const stt = await startFakeSttServer({ capabilities });
  fake = stt;
  return { cache: new SttCapabilityCache(new HttpSttClient(stt.url)), stt };
}

describe('SttCapabilityCache', () => {
  it('waits for an in-flight capability request when polling is stopped', async () => {
    const response = Promise.withResolvers<typeof NO_CAPABILITIES>();
    const cache = new SttCapabilityCache({ capabilities: () => response.promise });
    const stop = refreshEvery(cache, 20);
    let settled = false;
    const finishing = Promise.resolve(stop()).then(() => { settled = true; });
    try {
      await Promise.resolve();
      expect(settled).toBe(false);
    } finally {
      response.resolve(NO_CAPABILITIES);
      await finishing;
    }
    expect(settled).toBe(true);
  });

  it('knows nothing before the first refresh', async () => {
    const { cache, stt } = await cacheFor();

    expect(cache.current()).toEqual(NO_CAPABILITIES);
    expect(cache.supports(['sk'])).toBe(false);
    expect(stt.capabilityRequests()).toBe(0);
  });

  it('serves the last refreshed report', async () => {
    const { cache } = await cacheFor();
    await cache.refresh();

    expect(cache.current()).toEqual({ languages: ROUTING_STT.body.languages, models: ROUTING_MODELS });
  });

  it('shares one stt request between concurrent refreshes', async () => {
    const { cache, stt } = await cacheFor();
    await Promise.all([cache.refresh(), cache.refresh(), cache.refresh()]);

    expect(stt.capabilityRequests()).toBe(1);
    await cache.refresh();
    expect(stt.capabilityRequests()).toBe(2);
  });

  it('supports a selection only when every language is routable', async () => {
    const { cache } = await cacheFor({ status: 200, body: { languages: ['sk', 'cs'], models: ROUTING_MODELS } });
    await cache.refresh();

    expect(cache.supports(['cs', 'sk'])).toBe(true);
    expect(cache.supports(['sk', 'en'])).toBe(false);
    expect(cache.supports([])).toBe(false);
  });

  it('forgets the languages when the stt loses its routing models', async () => {
    const { cache, stt } = await cacheFor();
    await cache.refresh();
    stt.setCapabilities({ status: 200, body: { languages: [], models: { ...ROUTING_MODELS, conditioned: null, languageId: null } } });
    await cache.refresh();

    expect(cache.supports(['sk'])).toBe(false);
    expect(cache.current().models).toEqual({ transcription: ROUTING_MODELS.transcription, conditioned: null, languageId: null });
  });

  it('refreshes right away and then on every interval until stopped', async () => {
    const { cache, stt } = await cacheFor();
    const stop = refreshEvery(cache, 20);
    await waitUntil(() => stt.capabilityRequests() >= 3);
    await stop();
    const stopped = stt.capabilityRequests();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(cache.supports(['sk'])).toBe(true);
    expect(stt.capabilityRequests()).toBeLessThanOrEqual(stopped + 1);
  });
});
