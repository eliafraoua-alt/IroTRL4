import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  message?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ message = 'Chargement...' }) => (
  <div className="flex flex-col items-center justify-center gap-4 py-12">
    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
    <p className="text-sm text-slate-400 font-medium tracking-wide animate-pulse">
      {message}
    </p>
  </div>
);

export default LoadingSpinner;
