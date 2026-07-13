// @ts-ignore msw types
import { http, HttpResponse } from 'msw';

// ── Original Handlers ────────────────────────────────────────────────────────
export const handlers = [
  http.get('https://api.pappers.fr/v2/entreprise', ({ request }: { request: Request }) => {
    return HttpResponse.json({
      siren: "900123456",
      nom_entreprise: "IA Test Startup",
      capital: 50000,
      effectif: "3 à 5 salariés",
      dirigeants: [{ nom: "Dupont", prenom: "Jean" }]
    });
  }),
];

// ── Mock Gemini API ──────────────────────────────────────────────────────────
const mockGeminiResponse = {
  candidates: [{
    content: {
      parts: [{ text: JSON.stringify({
        DI: 2, ADC: 2, IPC: 2, AR: 2, CA: 2, GCH: 2,
        confidence: { ADC: 0.8, GCH: 0.7, IPC: 0.75 },
        srd: { VMM: 2, NCD: 1, DFL: 1 },
      })}],
    },
    finishReason: 'STOP',
  }],
};

// ── Mock Anthropic API ───────────────────────────────────────────────────────
const mockAnthropicResponse = {
  content: [{
    type: 'text',
    text: JSON.stringify({
      DI: 2, ADC: 3, IPC: 2, AR: 2, CA: 3, GCH: 2,
      confidence: { ADC: 0.85, GCH: 0.75, IPC: 0.80 },
      srd: { VMM: 2, NCD: 1, DFL: 2 },
    }),
  }],
  model: 'claude-sonnet-4-20250514',
  stop_reason: 'end_turn',
};

// ── Mock Mistral API ─────────────────────────────────────────────────────────
const mockMistralResponse = {
  choices: [{
    message: {
      content: JSON.stringify({
        DI: 2, ADC: 2, IPC: 3, AR: 2, CA: 2, GCH: 3,
        confidence: { ADC: 0.78, GCH: 0.72, IPC: 0.82 },
        srd: { VMM: 2, NCD: 2, DFL: 1 },
      }),
    },
    finish_reason: 'stop',
  }],
};

// ── Mock Pappers API ─────────────────────────────────────────────────────────
const mockPappersResponse = {
  siren: '123456789',
  nom_entreprise: 'Mock Startup SAS',
  date_creation: '2022-01-15',
  capital: 10000,
  dirigeants: [{ nom: 'Dupont', prenom: 'Jean', qualite: 'Président' }],
  dernier_traitement: '2026-01-01',
};

export const additionalHandlers = [
  // Gemini
  http.post('https://generativelanguage.googleapis.com/*', () =>
    HttpResponse.json(mockGeminiResponse)),

  // Anthropic
  http.post('https://api.anthropic.com/v1/messages', () =>
    HttpResponse.json(mockAnthropicResponse)),

  // Mistral
  http.post('https://api.mistral.ai/v1/chat/completions', () =>
    HttpResponse.json(mockMistralResponse)),

  // Pappers
  http.get('https://api.pappers.fr/*', () =>
    HttpResponse.json(mockPappersResponse)),

  // Health endpoint
  http.get('http://localhost:3000/api/health', () =>
    HttpResponse.json({ status: 'ok', version: '7.0.0' })),
];
