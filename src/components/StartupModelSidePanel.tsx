/**
 * StartupModelSidePanel — IRO v4.4
 *
 * AJOUTS v4.4 vs v4.3 :
 *   [NEW-TRL]  Champ TRL (1–9) dans la section DI
 *              → Règle : TRL≤4 plafonne IPC à 2, TRL≥7 bonus +0.1 sur DI
 *   [NEW-VRIN] Grille VRIN pour ADC et DI (4 critères Barney, 1991)
 *              → Score VRIN objectivise les scores ADC/DI actuellement fondés
 *                sur jugement global
 *   [NEW-JTBD] Champ "Criticité du Job" dans IPC (framework Christensen, 1997)
 *              → Fonctionnel / Émotionnel / Social
 *   [F5]       Disclaimer mode normatif visible dès l'ouverture du panneau
 */

import React, { useState } from 'react';
import {
  X, ChevronDown, ChevronUp, Sparkles, RotateCcw,
  FileText, AlignLeft, Check, Info, Shield,
} from 'lucide-react';
import {
  TRL_DESCRIPTIONS,
  computeVRINScore,
  buildIROMetadata,
  StartupModel,
  CONFIDENCE_LABELS,
} from '../types/iro';

// ── EMPTY_MODEL ──────────────────────────────────────────────────────────────
export const EMPTY_MODEL: StartupModel = {
  nom: '', secteur: '', vertical: '', date_creation: '', stade: '',
  di_llm_utilises: '', di_infra_propre: false, di_brevets: '', di_dependance_cloud: '',
  trl_niveau: '',
  di_vrin_valuable: false, di_vrin_rare: false, di_vrin_inimitable: false, di_vrin_non_sub: false,
  adc_type_donnees: '', adc_volume: '', adc_exclusivite: false, adc_source: '',
  adc_confiance: '',
  adc_vrin_valuable: false, adc_vrin_rare: false, adc_vrin_inimitable: false, adc_vrin_non_sub: false,
  ipc_clients_nommes: '', ipc_profondeur: '', ipc_contrats: '', ipc_confiance: '',
  ipc_job_type: '', ipc_job_criticite: '',
  ar_certifications: '', ar_conformite: '', ar_avantage_reglo: false,
  ca_pivots: '', ca_github_stars: '', ca_partenariats: '',
  gch_fondateurs: '', gch_equipe_size: '', gch_board: '', gch_recrutements: '',
  gch_founders: [],
  gch_confiance: '',
  srd_concurrents: '', srd_vitesse_marche: '', srd_dependance_fournisseur: '',
  texte_libre: '',
  external_pappers: '',
  age_mois: 0,
  arr_eur: undefined,
  arr_growth_12m: undefined,
  roas: undefined,
  ltv_eur: undefined,
  cac_eur: undefined,
  monthly_burn_eur: undefined,
};

// ── buildModelContext — injecté dans le prompt Gemini ────────────────────────

export function buildModelContext(m: StartupModel): string {
  const hasStructured = Object.entries(m)
    .filter(([k]) => k !== 'texte_libre' && k !== 'nom')
    .some(([, v]) => v !== '' && v !== false);
  const hasLibre = m.texte_libre.trim().length > 20;
  if (!hasStructured && !hasLibre) return '';

  const L: string[] = [
    '══════════════════════════════════════════════',
    'MODÈLE DE FONCTIONNEMENT — SOURCE UTILISATEUR',
    '(Priorité absolue sur Google Search)',
    '══════════════════════════════════════════════',
  ];

  const add = (label: string, val: string | boolean | undefined) => {
    if (val === '' || val === false || val === undefined) return;
    L.push(`${label} : ${val === true ? 'OUI' : val}`);
  };

  add('Secteur', m.secteur);
  add('Vertical IRO', m.vertical);
  add('Création', m.date_creation);
  add('Stade', m.stade);

  if (hasStructured) {
    L.push('', '── DI · DÉPENDANCE INFRA ──');
    add('LLM utilisés', m.di_llm_utilises);
    add('Infra propre', m.di_infra_propre);
    add('Brevets', m.di_brevets);
    add('Dépendance cloud', m.di_dependance_cloud);

    // [NEW-TRL]
    if (m.trl_niveau) {
      const trlDesc = TRL_DESCRIPTIONS[parseInt(m.trl_niveau)];
      L.push(`TRL estimé : TRL${m.trl_niveau} — ${trlDesc}`);
      if (parseInt(m.trl_niveau) <= 4) {
        L.push('  → RÈGLE TRL : IPC plafonné à 2 (maturité insuffisante pour intégration processus critiques)');
      }
      if (parseInt(m.trl_niveau) >= 7 && m.di_infra_propre) {
        L.push('  → RÈGLE TRL : bonus +0.1 sur DI (TRL≥7 + infra propre confirmée)');
      }
    }

    // [NEW-VRIN DI]
    const diVRIN = computeVRINScore({
      valuable: m.di_vrin_valuable, rare: m.di_vrin_rare,
      inimitable: m.di_vrin_inimitable, non_substituable: m.di_vrin_non_sub,
      justifications: {},
    });
    if (diVRIN.score > 0) {
      L.push(`VRIN DI (${diVRIN.score}/4 critères) → score DI recommandé : ${diVRIN.recommended_dim_score}`);
    }

    L.push('', '── ADC · ACTIF DE DONNÉES ──');
    add('Type données', m.adc_type_donnees);
    add('Confiance ADC', m.adc_confiance);
    add('Volume', m.adc_volume);
    add('Exclusivité', m.adc_exclusivite);
    add('Source', m.adc_source);

    // [NEW-VRIN ADC]
    const adcVRIN = computeVRINScore({
      valuable: m.adc_vrin_valuable, rare: m.adc_vrin_rare,
      inimitable: m.adc_vrin_inimitable, non_substituable: m.adc_vrin_non_sub,
      justifications: {},
    });
    if (adcVRIN.score > 0) {
      L.push(`VRIN ADC (${adcVRIN.score}/4 critères) → score ADC recommandé : ${adcVRIN.recommended_dim_score}`);
    }

    L.push('', '── IPC · INTÉGRATION PROCESSUS CRITIQUES ──');
    add('Clients nommés', m.ipc_clients_nommes);
    add('Profondeur', m.ipc_profondeur);
    add('Contrats', m.ipc_contrats);
    add('Confiance IPC', m.ipc_confiance);

    // [NEW-JTBD]
    if (m.ipc_job_type) {
      L.push(`Job-to-be-Done : ${m.ipc_job_type} (criticité ${m.ipc_job_criticite ?? '?'}/4)`);
      if (m.ipc_job_type === 'emotionnel' || m.ipc_job_type === 'social') {
        L.push('  → Job critique haute valeur : startup plus robuste à la substitution');
      }
    }

    L.push('', '── AR · ANTICIPATION RÉGLEMENTAIRE ──');
    add('Certifications', m.ar_certifications);
    add('Conformité', m.ar_conformite);
    add('Avantage réglementaire', m.ar_avantage_reglo);

    L.push('', '── CA · CAPACITÉ D\'ADAPTATION ──');
    add('Pivots', m.ca_pivots);
    add('GitHub', m.ca_github_stars);
    add('Partenariats', m.ca_partenariats);
    if (m.external_pappers) {
      L.push('', '── SOURCE PAPPERS / INPI / BODACC (CERTIFIÉ) ──');
      L.push(m.external_pappers);
    }

    L.push('', '── GCH · GOUVERNANCE & CAPITAL HUMAIN ──');
    add('Fondateurs (résumé)', m.gch_fondateurs);
    if (m.gch_founders && m.gch_founders.length > 0) {
      L.push('Détails Fondateurs Profilés :');
      m.gch_founders.forEach((f: any) => {
        L.push(`  • ${f.name} [${f.role}] - Ex: ${f.previous_companies?.join(', ')} | Edu: ${f.education?.join(', ')} | Pubs: ${f.publications?.length || 0}`);
      });
    }
    add('Équipe', m.gch_equipe_size);
    add('Board', m.gch_board);
    add('Recrutements', m.gch_recrutements);
    add('Confiance GCH', m.gch_confiance);

    L.push('', '── SRD · RISQUE MARCHÉ ──');
    add('Concurrents', m.srd_concurrents);
    add('Vélocité marché', m.srd_vitesse_marche);
    add('Dépendance fournisseur', m.srd_dependance_fournisseur);

    L.push('', '── FSF · METRIQUES FINANCIERES ──');
    if (m.arr_eur != null) L.push(`ARR (€) : ${m.arr_eur}`);
    if (m.arr_growth_12m != null) L.push(`Croissance ARR (xN) : ${m.arr_growth_12m}`);
    if (m.roas != null) L.push(`ROAS : ${m.roas}`);
    if (m.ltv_eur != null) L.push(`LTV (€) : ${m.ltv_eur}`);
    if (m.cac_eur != null) L.push(`CAC (€) : ${m.cac_eur}`);
    if (m.monthly_burn_eur != null) L.push(`Burn mensuel (€) : ${m.monthly_burn_eur}`);
  }

  if (hasLibre) {
    L.push('', '── DESCRIPTION LIBRE ──', m.texte_libre.trim());
  }

  L.push('══════════════════════════════════════════════');
  L.push('', 'INSTRUCTIONS : Évaluer indépendamment sans référence à d\'autres estimations.');
  L.push('Vérifier la cohérence avec le Gold Standard Delphi fourni dans le prompt système.');

  return L.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countFilled(m: StartupModel): number {
  return Object.entries(m)
    .filter(([k]) => k !== 'texte_libre')
    .filter(([, v]) => v !== '' && v !== false).length;
}

const TOTAL_FIELDS = Object.keys(EMPTY_MODEL).filter(k => k !== 'texte_libre').length;

// ── Micro-composants ──────────────────────────────────────────────────────────

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', marginBottom: 4, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 4 }}>
      {children}
      {hint && <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 9 }} title={hint}>(?)</span>}
    </div>
  );
}

const ConfidenceSelector: React.FC<{
  dimension: 'ipc' | 'adc' | 'gch';
  value: string;
  onChange: (v: string) => void;
}> = ({ dimension, value, onChange }) => (
  <div style={{ marginTop: 8, padding: 8, background: 'rgba(99,102,241,0.05)', borderRadius: 6, border: '1px solid rgba(99,102,241,0.15)' }}>
    <div style={{ fontSize: 9, fontWeight: 'bold', color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
      <Shield size={10} />
      Niveau de confiance — {dimension.toUpperCase()}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {Object.entries(CONFIDENCE_LABELS[dimension as keyof typeof CONFIDENCE_LABELS]).map(([level, label]) => (
        <label key={level} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: 4, borderRadius: 4, cursor: 'pointer', background: value === level ? 'rgba(99,102,241,0.1)' : 'transparent' }}>
          <input
            type="radio"
            name={`conf-${dimension}`}
            value={level}
            checked={value === level}
            onChange={() => onChange(level)}
            style={{ marginTop: 2 }}
          />
          <span style={{ fontSize: 9, color: value === level ? '#c7d2fe' : 'rgba(255,255,255,0.4)', lineHeight: 1.3 }}>
            <span style={{ fontFamily: 'monospace', marginRight: 4 }}>[{level}]</span> {label}
          </span>
        </label>
      ))}
    </div>
  </div>
);

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', background: 'rgba(0,0,0,0.25)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6, padding: '6px 9px',
        color: 'rgba(255,255,255,0.8)', fontSize: 11,
        outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'monospace',
        transition: 'border-color .15s',
      }}
      onFocus={e => (e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)')}
      onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
    />
  );
}

function NumericInput({ value, onChange, placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string }) {
  return (
    <input
      type="number"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={e => {
        const val = e.target.value;
        onChange(val === '' ? undefined : parseFloat(val));
      }}
      style={{
        width: '100%', background: 'rgba(0,0,0,0.25)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6, padding: '6px 9px',
        color: 'rgba(255,255,255,0.8)', fontSize: 11,
        outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'monospace',
        transition: 'border-color .15s',
      }}
      onFocus={e => (e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)')}
      onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
    />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', background: 'rgba(0,0,0,0.25)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6, padding: '6px 9px',
        color: value ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)',
        fontSize: 11, outline: 'none', cursor: 'pointer', boxSizing: 'border-box' as const,
      }}
    >
      <option value="">— Sélectionner —</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      onClick={() => onChange(!value)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
        fontSize: 11, color: value ? '#00c896' : 'rgba(255,255,255,0.35)',
        userSelect: 'none' as const,
      }}
    >
      <span style={{
        width: 30, height: 16, borderRadius: 8, flexShrink: 0, position: 'relative' as const,
        background: value ? '#00c896' : 'rgba(255,255,255,0.1)', transition: 'background .2s',
      }}>
        <span style={{
          position: 'absolute' as const, top: 2, left: value ? 16 : 2,
          width: 12, height: 12, borderRadius: '50%', background: '#fff',
          transition: 'left .15s',
        }} />
      </span>
      {label}
    </label>
  );
}

// [NEW] VRINGrid — grille de 4 critères VRIN avec score live
function VRINGrid({
  label,
  valuable, onValuable,
  rare, onRare,
  inimitable, onInimitable,
  nonSub, onNonSub,
  color,
}: {
  label: string;
  valuable: boolean; onValuable: (v: boolean) => void;
  rare: boolean; onRare: (v: boolean) => void;
  inimitable: boolean; onInimitable: (v: boolean) => void;
  nonSub: boolean; onNonSub: (v: boolean) => void;
  color: string;
}) {
  const score = [valuable, rare, inimitable, nonSub].filter(Boolean).length;
  return (
    <div style={{
      background: 'rgba(0,0,0,0.15)', borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.06)', padding: '8px 10px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', fontWeight: 700 }}>
          VRIN {label}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, color: score === 4 ? '#00c896' : score >= 2 ? color : 'rgba(255,255,255,0.3)',
          background: score > 0 ? `${score === 4 ? '#00c896' : color}18` : 'transparent',
          padding: '1px 7px', borderRadius: 4,
        }}>
          {score}/4 → score recommandé : {score}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {([
          ['V — Précieuse',        valuable,   onValuable,   'Cette ressource crée-t-elle de la valeur démontrable ?'],
          ['R — Rare',             rare,        onRare,        'Les concurrents directs y ont-ils accès ?'],
          ['I — Inimitable',       inimitable,  onInimitable,  'Faudrait-il >3 ans à un concurrent pour reproduire ?'],
          ['N — Non-substituable', nonSub,      onNonSub,      'Aucun substitut ne peut rendre le même service ?'],
        ] as [string, boolean, (v: boolean) => void, string][]).map(([lbl, val, fn, tip]) => (
          <label
            key={lbl}
            onClick={() => fn(!val)}
            title={tip}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
              padding: '4px 6px', borderRadius: 5,
              background: val ? `${color}12` : 'transparent',
              border: `1px solid ${val ? color + '40' : 'rgba(255,255,255,0.06)'}`,
              transition: 'all .15s',
            }}
          >
            <span style={{
              width: 12, height: 12, borderRadius: 3, flexShrink: 0,
              background: val ? color : 'rgba(255,255,255,0.08)',
              border: `1px solid ${val ? color : 'rgba(255,255,255,0.15)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8, color: '#fff',
            }}>
              {val ? '✓' : ''}
          </span>
            <span style={{ fontSize: 9, color: val ? color : 'rgba(255,255,255,0.35)', lineHeight: 1.3 }}>
              {lbl}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Section({
  title, color, accent, children, defaultOpen = false,
}: { title: string; color: string; accent: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderLeft: `2px solid ${open ? accent : 'rgba(255,255,255,0.06)'}`, marginBottom: 2, transition: 'border-color .2s' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 10px', cursor: 'pointer',
          background: open ? `${accent}08` : 'transparent', transition: 'background .15s',
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: '0.1em' }}>{title}</span>
        {open ? <ChevronUp size={12} color={color} /> : <ChevronDown size={12} color="rgba(255,255,255,0.25)" />}
      </div>
      {open && (
        <div style={{ padding: '8px 10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{children}</div>;
}

// Templates pré-remplis (identiques à v4.3, étendus avec les nouveaux champs)
const TEMPLATES: Record<string, { label: string; model: StartupModel }> = {
  HLTH: {
    label: 'Healthtech',
    model: {
      ...EMPTY_MODEL,
      nom: 'Alma Health', secteur: 'Santé IA — Imagerie médicale', vertical: 'HLTH',
      date_creation: 'Mars 2021', stade: 'Serie A — 12M€ (Janvier 2024)',
      di_llm_utilises: 'Mistral 7B fine-tuné on-premise, Claude API (fallback)',
      di_infra_propre: true,
      di_brevets: '3 brevets INPI déposés (analyse radiologique, 2022-2023)',
      di_dependance_cloud: 'Infra propre OVHcloud HDS + GPU A100 on-premise',
      trl_niveau: '8',
      di_vrin_valuable: true, di_vrin_rare: true, di_vrin_inimitable: true, di_vrin_non_sub: true,
      adc_type_donnees: 'comportementales',
      adc_volume: '850k images DICOM annotées par radiologue senior',
      adc_exclusivite: true,
      adc_source: 'Accord cadre AP-HP (5 ans, exclusivité diagnostic IA)',
      adc_vrin_valuable: true, adc_vrin_rare: true, adc_vrin_inimitable: true, adc_vrin_non_sub: true,
      ipc_clients_nommes: 'CHU Pitié-Salpêtrière, Hôpital Lariboisière, CHRU Lille',
      ipc_profondeur: 'Remplace le workflow de lecture scanner complet (4h → 8min)',
      ipc_contrats: '3 contrats pluriannuels signés > 120k€/an, ARR 380k€',
      ipc_confiance: '0.8',
      ipc_job_type: 'emotionnel', ipc_job_criticite: '4',
      ar_certifications: 'CE Medical Device Class IIa, ISO 13485, HDS hébergeur',
      ar_conformite: 'DPO nommé, AI Act Annex III analysé, CNIL conforme',
      ar_avantage_reglo: true,
      ca_pivots: 'Pivot de détection unique → plateforme multi-pathologies (Q2 2023)',
      ca_github_stars: '2 100 stars, 68 commits/mois, 12 contributors actifs',
      ca_partenariats: 'Nvidia Inception, Microsoft for Startups, BPI France Deeptech',
      gch_fondateurs: 'Dr. Sophie Martin (PhD Stanford, ex-DeepMind) + Alexis Roy (ex-McKinsey Healthcare, HEC)',
      gch_equipe_size: '24 personnes — 14 ingénieurs, 4 PhD, 3 médecins DU IA',
      gch_board: 'Pr. Axel Kahn (AP-HP), Sofinnova Partners (lead), Elaia Partners',
      gch_recrutements: '+55% effectifs sur 12 mois LinkedIn, CTO recruté ex-Owkin',
      srd_concurrents: 'Incepto Medical, Gleamer, Aidoc (US), Annalise.ai (AU)',
      srd_vitesse_marche: '3 nouveaux entrants/trimestre, Google Health annonce partenariat CHU Q3 2024',
      srd_dependance_fournisseur: 'Modèle propriétaire fine-tuné — indépendance quasi-totale OpenAI',
    },
  },
  SAAS: {
    label: 'SaaS Enterprise',
    model: {
      ...EMPTY_MODEL,
      nom: 'FlowState', secteur: 'SaaS IA — Productivité & Workflow', vertical: 'SAAS',
      date_creation: 'Septembre 2022', stade: 'Pre-seed — 1.2M€',
      di_llm_utilises: 'Claude 3.5 Sonnet, GPT-4o',
      di_infra_propre: false, di_brevets: 'Aucun',
      di_dependance_cloud: 'AWS (Irlande)',
      trl_niveau: '5',
      adc_type_donnees: 'sectorielles',
      adc_volume: 'Logs d\'activité de 5 000 utilisateurs beta',
      ipc_clients_nommes: 'Payfit, Alan, Spendesk (Beta)',
      ipc_confiance: '0.5',
      ipc_job_type: 'fonctionnel', ipc_job_criticite: '2',
      ar_certifications: 'RGPD compliant',
      ca_pivots: 'Focus initial Task Management → IA Agentic Workflow',
      ca_github_stars: '150 stars',
      gch_fondateurs: 'Thomas Durand (ex-Zenly) + Sarah Alami (ex-Criteo)',
      gch_equipe_size: '6 personnes — Full remote',
      srd_dependance_fournisseur: '100% dépendant des API Anthropic/OpenAI',
    },
  },
};

// ── Composant principal ───────────────────────────────────────────────────────

interface StartupModelSidePanelProps {
  open: boolean;
  onClose: () => void;
  value: StartupModel;
  onChange: (m: StartupModel) => void;
}

export default function StartupModelSidePanel({ open, onClose, value: m, onChange }: StartupModelSidePanelProps) {
  const [activeTab, setActiveTab] = useState<'form' | 'libre'>('form');
  const [templateApplied, setTemplateApplied] = useState(false);

  const set = <K extends keyof StartupModel>(k: K, v: StartupModel[K]) =>
    onChange({ ...m, [k]: v });

  const applyTemplate = (type: string) => {
    const template = TEMPLATES[type];
    if (!template) return;
    onChange({ ...template.model, nom: m.nom || template.model.nom });
    setTemplateApplied(true);
    setTimeout(() => setTemplateApplied(false), 2000);
  };

  const reset = () => { onChange(EMPTY_MODEL); setTemplateApplied(false); };

  const filled  = countFilled(m);
  const pct     = Math.round((filled / TOTAL_FIELDS) * 100);
  const hasData = filled > 0 || m.texte_libre.trim().length > 20;

  // [NEW-TRL] Avertissements TRL
  const trlNum        = m.trl_niveau ? parseInt(m.trl_niveau) : null;
  const trlCapsIPC    = trlNum !== null && trlNum <= 4;
  const trlBonus      = trlNum !== null && trlNum >= 7 && m.di_infra_propre;

  // [NEW-VRIN] Scores live
  const diVRINScore  = [m.di_vrin_valuable, m.di_vrin_rare, m.di_vrin_inimitable, m.di_vrin_non_sub].filter(Boolean).length;
  const adcVRINScore = [m.adc_vrin_valuable, m.adc_vrin_rare, m.adc_vrin_inimitable, m.adc_vrin_non_sub].filter(Boolean).length;

  // [F5] Metadata mode
  const iroMeta = buildIROMetadata(10);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed' as const, inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.55)',
          opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity .25s', backdropFilter: 'blur(2px)',
        }}
      />
      <div style={{
        position: 'fixed' as const, top: 0, left: 0, bottom: 0, width: 400, zIndex: 50,
        background: '#0b0f1a', borderRight: '1px solid rgba(99,102,241,0.2)',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform .28s cubic-bezier(.4,0,.2,1)',
        display: 'flex', flexDirection: 'column' as const,
        boxShadow: open ? '8px 0 40px rgba(0,0,0,0.6)' : 'none',
      }}>

        {/* Header */}
        <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(99,102,241,0.05)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#818cf8', letterSpacing: '0.1em' }}>
                MODÈLE DE FONCTIONNEMENT
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 2, letterSpacing: '0.06em' }}>
                Source de vérité prioritaire sur Google Search
              </div>
            </div>
            <button onClick={onClose} style={{ padding: 6, borderRadius: 6, cursor: 'pointer', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center' }}>
              <X size={14} />
            </button>
          </div>

          {/* [F5] Disclaimer normatif */}
          <div style={{ padding: '5px 8px', borderRadius: 5, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <Info size={10} color="#818cf8" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.38)', lineHeight: 1.5 }}>
              {iroMeta.ui_labels.mode_disclaimer}
            </span>
          </div>

          {/* Barre de progression */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>Remplissage</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: pct > 60 ? '#00c896' : pct > 30 ? '#f59e0b' : 'rgba(255,255,255,0.3)' }}>
                {filled}/{TOTAL_FIELDS} · {pct}%
              </span>
            </div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: pct > 60 ? '#00c896' : pct > 30 ? '#f59e0b' : '#6366f1', borderRadius: 2, transition: 'width .3s ease' }} />
            </div>
          </div>

          {/* Templates + reset */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const, marginBottom: 4 }}>
            {Object.entries(TEMPLATES).map(([key, t]) => (
              <button key={key} onClick={() => applyTemplate(key)} style={{
                flex: '1 0 45%', padding: '5px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer',
                background: templateApplied && m.vertical === key ? 'rgba(0,200,150,0.15)' : 'rgba(99,102,241,0.12)',
                border: `1px solid ${templateApplied && m.vertical === key ? 'rgba(0,200,150,0.3)' : 'rgba(99,102,241,0.25)'}`,
                color: templateApplied && m.vertical === key ? '#00c896' : '#818cf8',
                display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center',
              }}>
                <Sparkles size={9} /> {t.label}
              </button>
            ))}
          </div>
          <button onClick={reset} style={{ width: '100%', padding: '5px 10px', borderRadius: 6, cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>
            <RotateCcw size={9} /> Réinitialiser
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          {([['form', <FileText size={10} />, 'Formulaire'], ['libre', <AlignLeft size={10} />, 'Texte libre']] as const).map(([id, icon, label]) => (
            <button key={id} onClick={() => setActiveTab(id)} style={{
              flex: 1, padding: '8px 0', fontSize: 10, fontWeight: 700, cursor: 'pointer',
              background: 'transparent',
              borderBottom: activeTab === id ? '2px solid #6366f1' : '2px solid transparent',
              color: activeTab === id ? '#818cf8' : 'rgba(255,255,255,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              letterSpacing: '0.06em', transition: 'color .15s',
            }}>
              {icon}{label}
            </button>
          ))}
        </div>

        {/* Corps scrollable */}
        <div style={{ flex: 1, overflowY: 'auto' as const, padding: '10px 0' }}>
          {activeTab === 'form' && (
            <div>
              {/* Identité */}
              <Section title="IDENTITÉ" color="rgba(255,255,255,0.5)" accent="#6366f1" defaultOpen>
                <Label>Secteur / Domaine</Label>
                <Input value={m.secteur} onChange={v => set('secteur', v)} placeholder="ex: Santé IA, LegalTech, Fintech…" />
                <Label>Vertical IRO</Label>
                <Select value={m.vertical} onChange={v => set('vertical', v as StartupModel['vertical'])} options={[
                  { value: 'HLTH', label: 'HLTH — Healthtech / MedIA' },
                  { value: 'FINT', label: 'FINT — Fintech / InsurIA' },
                  { value: 'LEGT', label: 'LEGT — LegalTech / GovIA' },
                  { value: 'INDU', label: 'INDU — Industrie / IoT IA' },
                  { value: 'SAAS', label: 'SAAS — Enterprise SaaS IA' },
                ]} />
                <Grid2>
                  <div><Label>Date création</Label><Input value={m.date_creation} onChange={v => set('date_creation', v)} placeholder="ex: Juin 2021" /></div>
                  <div><Label>Stade</Label><Input value={m.stade} onChange={v => set('stade', v)} placeholder="ex: Serie A — 8M€" /></div>
                </Grid2>
              </Section>

              {/* DI */}
              <Section title="DI · DÉPENDANCE INFRA — 18%" color="#818cf8" accent="#818cf8">
                <Label>Modèles LLM utilisés</Label>
                <Input value={m.di_llm_utilises} onChange={v => set('di_llm_utilises', v)} placeholder="ex: GPT-4 Turbo (API), Mistral 7B self-hosted" />
                <Label>Dépendance cloud / fournisseur</Label>
                <Input value={m.di_dependance_cloud} onChange={v => set('di_dependance_cloud', v)} placeholder="ex: AWS us-east-1, pas de fallback" />
                <Label>Brevets déposés</Label>
                <Input value={m.di_brevets} onChange={v => set('di_brevets', v)} placeholder="ex: 2 brevets INPI — NLP médical, 2022-23" />
                <Toggle label="Infrastructure propre (GPU, fine-tuning, hébergement)" value={m.di_infra_propre} onChange={v => set('di_infra_propre', v)} />

                {/* [NEW-TRL] */}
                <Label hint="NASA/Commission Européenne. TRL≤4 plafonne IPC à 2. TRL≥7 + infra propre → bonus DI.">
                  Niveau TRL (1–9) — NASA / BPI France
                </Label>
                <Select value={m.trl_niveau} onChange={v => set('trl_niveau', v as StartupModel['trl_niveau'])} options={
                  Object.entries(TRL_DESCRIPTIONS).map(([k, d]) => ({ value: k, label: `TRL ${k} — ${d}` }))
                } />
                {trlCapsIPC && (
                  <div style={{ fontSize: 9, color: '#f59e0b', padding: '4px 8px', background: 'rgba(245,158,11,0.1)', borderRadius: 4, border: '1px solid rgba(245,158,11,0.2)' }}>
                    ⚠ TRL ≤ 4 → IPC sera plafonné à 2 lors de l'analyse (maturité insuffisante)
                  </div>
                )}
                {trlBonus && (
                  <div style={{ fontSize: 9, color: '#00c896', padding: '4px 8px', background: 'rgba(0,200,150,0.1)', borderRadius: 4, border: '1px solid rgba(0,200,150,0.2)' }}>
                    ✓ TRL ≥ 7 + infra propre → bonus +0.1 sur DI
                  </div>
                )}

                {/* [NEW-VRIN DI] */}
                <VRINGrid
                  label="DI — Cette infra est-elle…"
                  valuable={m.di_vrin_valuable} onValuable={v => set('di_vrin_valuable', v)}
                  rare={m.di_vrin_rare} onRare={v => set('di_vrin_rare', v)}
                  inimitable={m.di_vrin_inimitable} onInimitable={v => set('di_vrin_inimitable', v)}
                  nonSub={m.di_vrin_non_sub} onNonSub={v => set('di_vrin_non_sub', v)}
                  color="#818cf8"
                />
                {diVRINScore > 0 && (
                  <div style={{ fontSize: 9, color: '#818cf8', textAlign: 'center' as const }}>
                    Grille VRIN DI : {diVRINScore}/4 IQ → score DI recommandé = {diVRINScore}
                  </div>
                )}
              </Section>

              {/* ADC */}
              <Section title="ADC · ACTIF DE DONNÉES — 22%" color="#34d399" accent="#34d399">
                <Label>Type de données</Label>
                <Select value={m.adc_type_donnees} onChange={v => set('adc_type_donnees', v as StartupModel['adc_type_donnees'])} options={[
                  { value: 'generiques',      label: 'Génériques (score 0–1)' },
                  { value: 'sectorielles',     label: 'Sectorielles (score 2–3)' },
                  { value: 'comportementales', label: 'Comportementales VRIN (score 4)' },
                ]} />
                <Label>Volume et format</Label>
                <Input value={m.adc_volume} onChange={v => set('adc_volume', v)} placeholder="ex: 500k ordonnances annotées, format DICOM" />
                <Label>Source et accord d'exclusivité</Label>
                <Input value={m.adc_source} onChange={v => set('adc_source', v)} placeholder="ex: partenariat AP-HP, exclusivité 5 ans" />
                <Toggle label="Données exclusives / impossibles à reproduire" value={m.adc_exclusivite} onChange={v => set('adc_exclusivite', v)} />
                <ConfidenceSelector dimension="adc" value={m.adc_confiance} onChange={v => set('adc_confiance', v as StartupModel['adc_confiance'])} />

                {/* [NEW-VRIN ADC] */}
                <VRINGrid
                  label="ADC — Ces données sont-elles…"
                  valuable={m.adc_vrin_valuable} onValuable={v => set('adc_vrin_valuable', v)}
                  rare={m.adc_vrin_rare} onRare={v => set('adc_vrin_rare', v)}
                  inimitable={m.adc_vrin_inimitable} onInimitable={v => set('adc_vrin_inimitable', v)}
                  nonSub={m.adc_vrin_non_sub} onNonSub={v => set('adc_vrin_non_sub', v)}
                  color="#34d399"
                />
                {adcVRINScore > 0 && (
                  <div style={{ fontSize: 9, color: '#34d399', textAlign: 'center' as const }}>
                    Grille VRIN ADC : {adcVRINScore}/4 IQ → score ADC recommandé = {adcVRINScore}
                  </div>
                )}
              </Section>

              {/* IPC */}
              <Section title="IPC · INTÉGRATION PROCESSUS — 22%" color="#fbbf24" accent="#fbbf24">
                <Label>Clients nommés et référençables</Label>
                <Input value={m.ipc_clients_nommes} onChange={v => set('ipc_clients_nommes', v)} placeholder="ex: MAIF, Crédit Agricole, Doctolib" />
                <Label>Profondeur d'intégration workflow</Label>
                <Input value={m.ipc_profondeur} onChange={v => set('ipc_profondeur', v)} placeholder="ex: remplace traitement sinistre complet (3h → 12min)" />
                <Label>Contrats et revenus</Label>
                <Input value={m.ipc_contrats} onChange={v => set('ipc_contrats', v)} placeholder="ex: 3 contrats annuels > 50k€, ARR 180k€" />
                <ConfidenceSelector dimension="ipc" value={m.ipc_confiance} onChange={v => set('ipc_confiance', v as StartupModel['ipc_confiance'])} />

                {/* [NEW-JTBD] */}
                <Label hint="Christensen, 1997. Les jobs émotionnels/sociaux sont plus résistants à la substitution.">
                  Job-to-be-Done — Type de problème résolu
                </Label>
                <Select value={m.ipc_job_type} onChange={v => set('ipc_job_type', v as StartupModel['ipc_job_type'])} options={[
                  { value: 'fonctionnel', label: 'Fonctionnel — tâche à accomplir' },
                  { value: 'emotionnel',  label: 'Émotionnel — anxiété, confiance, risque' },
                  { value: 'social',      label: 'Social — statut, reconnaissance' },
                ]} />
                {m.ipc_job_type && (
                  <>
                    <Label>Criticité du Job (1–4)</Label>
                    <Select value={m.ipc_job_criticite} onChange={v => set('ipc_job_criticite', v as StartupModel['ipc_job_criticite'])} options={[
                      { value: '1', label: '1 — Faible (commodité, convenience)' },
                      { value: '2', label: '2 — Modérée (amélioration sensible)' },
                      { value: '3', label: '3 — Haute (douleur significative résolue)' },
                      { value: '4', label: '4 — Critique (risque vital, compliance, sécurité)' },
                    ]} />
                    {m.ipc_job_type === 'emotionnel' && parseInt(m.ipc_job_criticite || '0') >= 3 && (
                      <div style={{ fontSize: 9, color: '#00c896', padding: '4px 8px', background: 'rgba(0,200,150,0.08)', borderRadius: 4 }}>
                        ✓ Job émotionnel critique → robustesse IPC maximale (substitution difficile)
                      </div>
                    )}
                  </>
                )}
              </Section>

              {/* AR */}
              <Section title="AR · ANTICIPATION RÉGLEMENTAIRE — 13%" color="#60a5fa" accent="#60a5fa">
                <Label>Certifications et normes obtenues</Label>
                <Input value={m.ar_certifications} onChange={v => set('ar_certifications', v)} placeholder="ex: ISO 27001, CE Medical Device IIa, HDS" />
                <Label>Actions de conformité en cours</Label>
                <Input value={m.ar_conformite} onChange={v => set('ar_conformite', v)} placeholder="ex: DPO nommé, AI Act Annex III analysé" />
                <Toggle label="La conformité est un avantage concurrentiel" value={m.ar_avantage_reglo} onChange={v => set('ar_avantage_reglo', v)} />
              </Section>

              {/* CA */}
              <Section title="CA · CAPACITÉ D'ADAPTATION — 13%" color="#f87171" accent="#f87171">
                <Label>Pivots stratégiques datés</Label>
                <Input value={m.ca_pivots} onChange={v => set('ca_pivots', v)} placeholder="ex: pivot B2C→B2B, Jan 2024" />
                <Label>GitHub / activité open-source</Label>
                <Input value={m.ca_github_stars} onChange={v => set('ca_github_stars', v)} placeholder="ex: 1 200 stars, 45 commits/mois" />
                <Label>Partenariats technologiques</Label>
                <Input value={m.ca_partenariats} onChange={v => set('ca_partenariats', v)} placeholder="ex: Microsoft for Startups, AWS Activate" />
              </Section>

              {/* GCH */}
              <Section title="GCH · GOUVERNANCE & CAPITAL HUMAIN — 12%" color="#e879f9" accent="#e879f9">
                <Label>Profils fondateurs</Label>
                <Input value={m.gch_fondateurs} onChange={v => set('gch_fondateurs', v)} placeholder="ex: ex-Google Brain (PhD) + ex-McKinsey (HEC)" />
                <Grid2>
                  <div><Label>Équipe</Label><Input value={m.gch_equipe_size} onChange={v => set('gch_equipe_size', v)} placeholder="ex: 18 pers." /></div>
                  <div><Label>Croissance</Label><Input value={m.gch_recrutements} onChange={v => set('gch_recrutements', v)} placeholder="ex: +40% sur 12m" /></div>
                </Grid2>
                <Label>Board et investisseurs</Label>
                <Input value={m.gch_board} onChange={v => set('gch_board', v)} placeholder="ex: Xavier Niel, Sofinnova Partners" />
                <ConfidenceSelector dimension="gch" value={m.gch_confiance} onChange={v => set('gch_confiance', v as StartupModel['gch_confiance'])} />
              </Section>

              {/* SRD */}
              <Section title="SRD · RISQUE MARCHÉ (VMM / NCD / DFL)" color="#f97316" accent="#f97316">
                <Label>Concurrents directs identifiés</Label>
                <Input value={m.srd_concurrents} onChange={v => set('srd_concurrents', v)} placeholder="ex: Nabla, Abridge, Nuance DAX (Microsoft)" />
                <Label>Vélocité du marché LLM</Label>
                <Input value={m.srd_vitesse_marche} onChange={v => set('srd_vitesse_marche', v)} placeholder="ex: OpenAI lance GPT-4o Health Q2 2024" />
                <Label>Dépendance fournisseur LLM</Label>
                <Input value={m.srd_dependance_fournisseur} onChange={v => set('srd_dependance_fournisseur', v)} placeholder="ex: 100% OpenAI API, pas de fallback" />
              </Section>

              {/* FSF Financial Metrics */}
              <Section title="FSF · MÉTRIQUES FINANCIÈRES (OPTIONNEL)" color="#a855f7" accent="#a855f7">
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 8, lineHeight: 1.4 }}>
                  Ces données financières optionnelles servent au calcul du Financial Sustainability Factor (FSF) sur l'horizon opérationnel de 18 mois.
                </div>
                <Label>ARR (€)</Label>
                <NumericInput value={m.arr_eur} onChange={v => set('arr_eur', v)} placeholder="ex: 8000000" />
                <Label>Croissance ARR sur 12M (xN)</Label>
                <NumericInput value={m.arr_growth_12m} onChange={v => set('arr_growth_12m', v)} placeholder="ex: 2.5 (pour x2.5)" />
                <Label>ROAS (décimal, ex: 1.18 pour 118%)</Label>
                <NumericInput value={m.roas} onChange={v => set('roas', v)} placeholder="ex: 1.18" />
                <Grid2>
                  <div>
                    <Label>LTV par client (€)</Label>
                    <NumericInput value={m.ltv_eur} onChange={v => set('ltv_eur', v)} placeholder="ex: 45000" />
                  </div>
                  <div>
                    <Label>CAC par client (€)</Label>
                    <NumericInput value={m.cac_eur} onChange={v => set('cac_eur', v)} placeholder="ex: 15000" />
                  </div>
                </Grid2>
                <Label>Burn mensuel (€)</Label>
                <NumericInput value={m.monthly_burn_eur} onChange={v => set('monthly_burn_eur', v)} placeholder="ex: 350000" />
              </Section>
            </div>
          )}

          {activeTab === 'libre' && (
            <div style={{ padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 10, lineHeight: 1.6 }}>
                Collez ici un pitch deck, executive summary ou description existante.
                Gemini extraira les signaux IRO pertinents automatiquement.
              </div>
              <textarea
                value={m.texte_libre}
                onChange={e => set('texte_libre', e.target.value)}
                placeholder={`Exemple :\n\nAlma est une startup healthtech fondée en 2020 par deux ex-Google Brain. Elle propose une plateforme d'analyse d'imagerie médicale intégrée dans le PACS des hôpitaux. La solution traite 12 000 scanners/jour pour 8 CHU partenaires (contrats 3 ans). Elle dispose de 850k images annotées exclusivement (accord AP-HP). Stack : Mistral 7B fine-tuné on-premise, sans dépendance OpenAI. Certifiée CE Medical Device IIa. Équipe 24 personnes, +50% en 12 mois.`}
                style={{
                  width: '100%', minHeight: 260, background: 'rgba(0,0,0,0.25)',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '10px 12px',
                  color: 'rgba(255,255,255,0.8)', fontSize: 11, fontFamily: 'monospace',
                  lineHeight: 1.6, outline: 'none', resize: 'vertical' as const, boxSizing: 'border-box' as const,
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
              />
              <div style={{ textAlign: 'right' as const, fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 5 }}>
                {m.texte_libre.length} caractères
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)', flexShrink: 0 }}>
          {hasData && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, marginBottom: 8, background: 'rgba(0,200,150,0.08)', border: '1px solid rgba(0,200,150,0.2)' }}>
              <Check size={11} color="#00c896" />
              <span style={{ fontSize: 10, color: '#00c896', fontWeight: 700 }}>
                Modèle actif — sera injecté dans l'analyse Gemini
              </span>
            </div>
          )}
          <button onClick={onClose} style={{
            width: '100%', padding: '9px 0', borderRadius: 8, fontSize: 11, fontWeight: 800,
            cursor: 'pointer', letterSpacing: '0.08em',
            background: hasData ? 'linear-gradient(135deg, #6366f1, #e879f9)' : 'rgba(255,255,255,0.06)',
            color: hasData ? '#fff' : 'rgba(255,255,255,0.4)', border: 'none',
          }}>
            {hasData ? `Valider et analyser (${filled} champs)` : 'Fermer sans données'}
          </button>
        </div>
      </div>
    </>
  );
}
