import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OverlayApp } from './OverlayApp';
import '../styles/tokens.css';
import './overlay.css';
import '../styles/interaction.css';

const container = document.getElementById('overlay-root');
if (container === null) {
  throw new Error('Missing #overlay-root element');
}

createRoot(container).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>,
);
