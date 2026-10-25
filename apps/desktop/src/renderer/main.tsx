import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/app.css';
import './styles/home.css';
import './styles/controls.css';
import './styles/settings.css';
import './styles/pages.css';
import './styles/onboarding.css';
import './styles/interaction.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
