import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const silenceScriptErrors = () => {
  window.addEventListener('error', (e) => {
    if (e.message === 'Script error.' || e.message === 'Script error') {
       e.preventDefault();
       e.stopImmediatePropagation();
    }
  }, true);
  
  const originalError = console.error;
  console.error = (...args) => {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('Script error')) {
      return;
    }
    originalError(...args);
  };
};

silenceScriptErrors();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
