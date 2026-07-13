// src/utils/circuit-breaker.ts
export type CBState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CBConfig {
  failureThreshold: number;   // échecs consécutifs avant ouverture
  successThreshold: number;   // succès consécutifs en HALF_OPEN pour fermer
  cooldownMs:       number;   // durée d'ouverture avant tentative HALF_OPEN
}

const DEFAULT_CONFIG: CBConfig = {
  failureThreshold: 3,
  successThreshold: 1,
  cooldownMs:       60_000,
};

export class CircuitBreaker {
  private state:          CBState = 'CLOSED';
  private failures:       number  = 0;
  private successes:      number  = 0;
  private lastOpenedAt:   number  = 0;
  private readonly cfg:   CBConfig;

  constructor(cfg: Partial<CBConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
  }

  get currentState(): CBState { return this.state; }

  canAttempt(): boolean {
    if (this.state === 'CLOSED')    return true;
    if (this.state === 'HALF_OPEN') return true;
    // OPEN : vérifier si le cooldown est écoulé
    if (Date.now() - this.lastOpenedAt >= this.cfg.cooldownMs) {
      this.state = 'HALF_OPEN';
      this.successes = 0;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.cfg.successThreshold) {
        this.state = 'CLOSED';
      }
    }
  }

  recordFailure(): void {
    this.successes = 0;
    this.failures++;
    if (this.failures >= this.cfg.failureThreshold) {
      this.state = 'OPEN';
      this.lastOpenedAt = Date.now();
    }
  }

  reset(): void {
    this.state     = 'CLOSED';
    this.failures  = 0;
    this.successes = 0;
  }
}

// Registre singleton par provider
const registry = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(provider: string): CircuitBreaker {
  if (!registry.has(provider)) {
    registry.set(provider, new CircuitBreaker());
  }
  return registry.get(provider)!;
}

export function resetAllBreakers(): void {
  registry.forEach(cb => cb.reset());
}
