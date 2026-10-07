import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
// La fuente va en el bundle (woff2 de @fontsource), nunca de un CDN.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './index.css';
import App from './App.tsx';
import { aplicarTema, temaGuardado } from './lib/tema';

// Antes del primer pintado, para que un tema fijado no parpadee.
aplicarTema(temaGuardado());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
