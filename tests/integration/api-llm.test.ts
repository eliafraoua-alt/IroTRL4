import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startTestServer, stopTestServer, baseUrl }       from './setup';

// Mock @google/genai pour éviter appels réseau réels
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify({ DI: 2, ADC: 3, IPC: 2, AR: 2, CA: 3, GCH: 3 }),
      }),
    };
  },
}));

beforeAll(startTestServer);
afterAll(stopTestServer);

describe('POST /api/llm — intégration', () => {
  it('retourne 400 si prompt absent', async () => {
    const res = await fetch(`${baseUrl}/api/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toMatch(/prompt/i);
  });

  it('retourne 401 si GEMINI_API_KEY absente', async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const res = await fetch(`${baseUrl}/api/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });
    expect(res.status).toBe(401);
    process.env.GEMINI_API_KEY = saved;
  });

  it('retourne 200 avec text quand Gemini répond', async () => {
    const res = await fetch(`${baseUrl}/api/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Score cette startup', modelId: 'gemini-3.5-flash' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { text: string; provider: string };
    expect(body.text).toBeTruthy();
    expect(body.provider).toBe('Gemini');
  });

  it('Content-Type est application/json (pas de HTML)', async () => {
    const res = await fetch(`${baseUrl}/api/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});
