import React, { useState, useCallback, useRef } from 'react';
import { Upload, FileText, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PdfUploaderProps {
  onTextExtracted: (text: string, detectedName?: string, financialSignals?: any) => void;
  currentText: string;
  disabled?: boolean;
  className?: string;
}

type ExtractionStatus =
  | { state: 'idle' }
  | { state: 'loading'; fileName: string; progress: string }
  | { state: 'success'; fileName: string; charCount: number; method: string }
  | { state: 'error'; message: string };

// ── Extraction via Gemini (PDF multimodal call on Server Proxy) ───────────────

async function extractWithGemini(
  fileBase64: string,
  mimeType: string,
  fileName: string,
): Promise<{ text: string; detectedName?: string; financialSignals?: any }> {

  const response = await fetch('/api/llm/extract-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileBase64,
      mimeType,
      fileName,
    }),
  });

  if (!response.ok) {
    const errObj = await response.json().catch(() => ({}));
    throw new Error(errObj.message || errObj.error || `Erreur API : ${response.status} ${response.statusText}`);
  }

  const parsed = await response.json();

  // Enrichir le texte extrait avec les signaux financiers si présents
  let enrichedText = parsed.extracted_text || '';
  const fin = parsed.financial_signals;
  if (fin && Object.values(fin).some(v => v !== null)) {
    enrichedText += '\n\n=== SIGNAUX FINANCIERS EXTRAITS (PATCH5) ===\n';
    if (fin.arr_eur != null)               enrichedText += `ARR : ${fin.arr_eur} EUR\n`;
    if (fin.arr_growth_12m != null)        enrichedText += `Croissance ARR 12m : ×${fin.arr_growth_12m}\n`;
    if (fin.roas != null)                  enrichedText += `ROAS : ${Math.round(fin.roas * 100)}%\n`;
    if (fin.ltv_eur != null)               enrichedText += `LTV : ${fin.ltv_eur} EUR\n`;
    if (fin.cac_eur != null)               enrichedText += `CAC : ${fin.cac_eur} EUR\n`;
    if (fin.valuation_premoney_eur != null) enrichedText += `Valorisation pré-money : ${fin.valuation_premoney_eur} EUR\n`;
    if (fin.raise_amount_eur != null)      enrichedText += `Montant levée : ${fin.raise_amount_eur} EUR\n`;
  }

  return {
    text: enrichedText,
    detectedName: parsed.startup_name ?? undefined,
    financialSignals: fin ?? undefined,
  };
}

// ── Extraction texte brut (TXT, MD) ──────────────────────────────────────────

function extractPlainText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target?.result as string ?? '');
    reader.onerror = () => reject(new Error('Lecture du fichier échouée'));
    reader.readAsText(file, 'utf-8');
  });
}

// ── FileReader base64 ─────────────────────────────────────────────────────────

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const result = e.target?.result as string;
      // Retirer le préfixe data:...;base64,
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(new Error('Lecture base64 échouée'));
    reader.readAsDataURL(file);
  });
}

// ── Composant principal ───────────────────────────────────────────────────────

const PdfUploader: React.FC<PdfUploaderProps> = ({
  onTextExtracted,
  currentText,
  disabled = false,
  className = '',
}) => {
  const [status, setStatus] = useState<ExtractionStatus>({ state: 'idle' });
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const ACCEPTED_TYPES = {
    'application/pdf': ['.pdf'],
    'text/plain': ['.txt'],
    'text/markdown': ['.md'],
  };
  const ACCEPT_STRING = '.pdf,.txt,.md';
  const MAX_SIZE_MB = 20;

  const processFile = useCallback(async (file: File) => {
    if (disabled) return;

    // Validation taille
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setStatus({ state: 'error', message: `Fichier trop volumineux (max ${MAX_SIZE_MB} Mo). Compressez le PDF ou réduisez le nombre de slides.` });
      return;
    }

    const ext = file.name.toLowerCase().split('.').pop();
    const isPdf = ext === 'pdf' || file.type === 'application/pdf';
    const isText = ext === 'txt' || ext === 'md' || file.type.startsWith('text/');

    if (!isPdf && !isText) {
      setStatus({ state: 'error', message: `Format non supporté (${ext}). Formats acceptés : PDF, TXT, MD.` });
      return;
    }

    setStatus({ state: 'loading', fileName: file.name, progress: 'Lecture du fichier...' });

    try {
      let extractedText = '';
      let detectedName: string | undefined;
      let financialSignals: any;
      let method = '';

      if (isText) {
        // Extraction directe
        extractedText = await extractPlainText(file);
        method = 'Texte brut';
        setStatus({ state: 'loading', fileName: file.name, progress: 'Texte extrait...' });

      } else if (isPdf) {
        // PDF → Gemini multimodal
        setStatus({ state: 'loading', fileName: file.name, progress: 'Envoi à Gemini pour extraction...' });
        const base64 = await readFileAsBase64(file);
        const result = await extractWithGemini(base64, 'application/pdf', file.name);
        extractedText = result.text;
        detectedName = result.detectedName;
        financialSignals = result.financialSignals;
        method = 'Gemini-3.5-Flash (extraction structurée)';
      }

      if (!extractedText.trim()) {
        setStatus({ state: 'error', message: 'Document vide ou extraction impossible. Essayez de copier-coller le texte directement.' });
        return;
      }

      onTextExtracted(extractedText, detectedName, financialSignals);
      setStatus({
        state: 'success',
        fileName: file.name,
        charCount: extractedText.length,
        method,
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ state: 'error', message: `Extraction échouée : ${msg}` });
    }
  }, [disabled, onTextExtracted]);

  // Drag & drop handlers
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input pour permettre re-upload du même fichier
    e.target.value = '';
  }, [processFile]);

  const handleReset = useCallback(() => {
    setStatus({ state: 'idle' });
    onTextExtracted('', undefined);
  }, [onTextExtracted]);

  // ── Rendu ─────────────────────────────────────────────────────────────────

  // Succès
  if (status.state === 'success') {
    return (
      <div className={`rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 flex items-center justify-between ${className}`}>
        <div className="flex items-center gap-3">
          <CheckCircle size={16} className="text-emerald-400 shrink-0" />
          <div>
            <p className="text-xs font-bold text-emerald-400">{status.fileName}</p>
            <p className="text-[12px] text-slate-500 font-mono mt-0.5">
              {status.charCount.toLocaleString()} car. extraits · {status.method}
            </p>
          </div>
        </div>
        <button
          onClick={handleReset}
          className="text-slate-500 hover:text-red-400 transition-colors ml-3 shrink-0 cursor-pointer"
          title="Supprimer"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  // Chargement
  if (status.state === 'loading') {
    return (
      <div className={`rounded-lg border border-indigo-500/40 bg-indigo-500/5 px-4 py-3 flex items-center gap-3 ${className}`}>
        <Loader2 size={16} className="text-indigo-400 shrink-0 animate-spin" />
        <div>
          <p className="text-xs font-bold text-indigo-400">{status.fileName}</p>
          <p className="text-[12px] text-slate-500 font-mono mt-0.5">{status.progress}</p>
        </div>
      </div>
    );
  }

  // Erreur
  if (status.state === 'error') {
    return (
      <div className={`rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 ${className}`}>
        <div className="flex items-start gap-3">
          <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-red-400">Extraction échouée</p>
            <p className="text-[12px] text-slate-500 mt-0.5 break-words">{status.message}</p>
          </div>
          <button
            onClick={() => setStatus({ state: 'idle' })}
            className="text-slate-500 hover:text-slate-300 transition-colors shrink-0 cursor-pointer"
            title="Réessayer"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  // Idle — Drop zone principale
  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_STRING}
        onChange={handleChange}
        disabled={disabled}
        className="hidden"
        id="pdf-upload-input"
      />
      <label
        htmlFor="pdf-upload-input"
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`
          flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed cursor-pointer
          transition-all duration-200 select-none
          ${disabled
            ? 'opacity-40 cursor-not-allowed border-slate-700 bg-slate-900'
            : dragActive
              ? 'border-indigo-400 bg-indigo-500/10 scale-[1.01]'
              : currentText.trim()
                ? 'border-slate-600 bg-slate-900/50 hover:border-slate-500'
                : 'border-indigo-500/40 bg-indigo-500/5 hover:border-indigo-400 hover:bg-indigo-500/10'
          }
        `}
      >
        <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
          ${dragActive ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-indigo-400'}`}>
          {dragActive ? <Upload size={16} /> : <FileText size={16} />}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-300 truncate">
            {dragActive ? 'Déposez le fichier ici' : 'Déposer ou cliquer pour uploader un PDF/pitch deck'}
          </p>
          <p className="text-[12px] text-slate-600 font-mono mt-0.5">
            PDF · TXT · MD — max {MAX_SIZE_MB} Mo — extraction via Gemini
          </p>
        </div>
      </label>
    </div>
  );
};

export default PdfUploader;
