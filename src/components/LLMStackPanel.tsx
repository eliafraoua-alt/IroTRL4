/**
 * LLMStackPanel 
 * Visualisation des dépendances LLM d'une startup
 *
 * Corrections v1.1 :
 *   - Import corrigé : '../types/iro' → './types/iro' (ou chemin relatif correct
 *     selon la position du fichier dans src/).
 *
 *   Arborescence attendue :
 *     src/
 *       types/
 *         iro.ts              ← source de vérité
 *       components/
 *         LLMStackPanel.tsx   ← ce fichier
 */

import { LLMStack } from '../types/iro'; // ✅ correct si ce fichier est dans src/components/

interface LLMStackPanelProps {
  stack: LLMStack | null | undefined;
}

const LEVEL_COLOR: Record<string, string> = {
  'API':         '#FF6B35',
  'Fine-tuned':  '#F5A623',
  'Self-hosted': '#00D4AA',
  'Hybrid':      '#4F9CF9',
};

const LEVEL_LABEL: Record<string, string> = {
  'API':         'Appel API externe — dépendance forte (signal DI faible)',
  'Fine-tuned':  'Modèle fine-tuné — différenciation partielle',
  'Self-hosted': 'Auto-hébergé — autonomie infra (signal DI fort)',
  'Hybrid':      'Architecture hybride — autonomie partielle',
};

export default function LLMStackPanel({ stack }: LLMStackPanelProps) {
  if (!stack) return null;

  const levelColor = LEVEL_COLOR[stack.integration_level] ?? '#888';

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 14, padding: '16px 18px',
    }}>
      <div style={{
        fontSize: 10, color: 'rgba(255,255,255,0.22)',
        letterSpacing: '0.1em', marginBottom: 12,
      }}>
        STACK LLM & INTÉGRATION
      </div>

      {/* Niveau d'intégration */}
      <div style={{ marginBottom: 12 }}>
        <span style={{
          padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
          background: `${levelColor}20`, color: levelColor,
          border: `1px solid ${levelColor}40`,
        }}>
          {stack.integration_level}
        </span>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', margin: '6px 0 0', lineHeight: 1.5 }}>
          {LEVEL_LABEL[stack.integration_level] ?? ''}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {stack.models.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)', marginBottom: 6, letterSpacing: '0.08em' }}>
              MODÈLES LLM
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {stack.models.map(m => (
                <span key={m} style={{
                  padding: '2px 7px', borderRadius: 4, fontSize: 11,
                  background: 'rgba(79,156,249,0.12)', color: '#4F9CF9',
                }}>
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}

        {stack.frameworks.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)', marginBottom: 6, letterSpacing: '0.08em' }}>
              FRAMEWORKS IA
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {stack.frameworks.map(f => (
                <span key={f} style={{
                  padding: '2px 7px', borderRadius: 4, fontSize: 11,
                  background: 'rgba(0,212,170,0.1)', color: '#00D4AA',
                }}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
