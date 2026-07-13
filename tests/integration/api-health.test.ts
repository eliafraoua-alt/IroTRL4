import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, stopTestServer, baseUrl }       from './setup';

beforeAll(startTestServer);
afterAll(stopTestServer);

describe('GET /api/health — intégration', () => {
  it('retourne les données de santé de l\'application', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; version: string; providers: Record<string, boolean> };
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
    expect(body.providers.gemini).toBe(true);
  });
});
