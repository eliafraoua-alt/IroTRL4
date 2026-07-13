import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { calibrateConformalScores } from './utils/conformal-bands';

// Calibrer une fois au démarrage (Singleton)
try {
  calibrateConformalScores();
} catch (e) {
  console.error('Erreur calibration conformal au démarrage', e);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
