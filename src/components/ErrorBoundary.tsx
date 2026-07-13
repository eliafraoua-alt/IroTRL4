/**
 * src/components/ErrorBoundary.tsx
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  CORRECTIF MAINT-02 (Audit OPRO v2.0 — Avril 2026)         ║
 * ║  Error Boundary React — capture les erreurs de rendu        ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Usage :
 *   <ErrorBoundary>
 *     <MonComposant />
 *   </ErrorBoundary>
 *
 *   <ErrorBoundary fallback={<p>Erreur dans ce panneau</p>}>
 *     <PanneauComplexe />
 *   </ErrorBoundary>
 */

import React, { type ErrorInfo, type ReactNode } from 'react';
import { logger } from '../utils/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('Erreur React non gérée', {
      message: error.message,
      stack: error.stack?.slice(0, 500),
      componentStack: info.componentStack?.slice(0, 500),
    });
    this.props.onError?.(error, info);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] p-6 rounded-xl border border-red-500/30 bg-red-500/5 text-red-400 font-mono">
        <div className="text-2xl mb-3">⚠</div>
        <div className="text-sm font-bold mb-1">Erreur de rendu</div>
        <div className="text-xs text-red-400/70 mb-4 max-w-md text-center">
          {this.state.error?.message ?? 'Erreur inconnue'}
        </div>
        <button
          onClick={this.handleReset}
          className="px-4 py-1.5 text-xs font-bold rounded-lg border border-red-500/40 hover:bg-red-500/10 transition-colors"
        >
          Réessayer
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
