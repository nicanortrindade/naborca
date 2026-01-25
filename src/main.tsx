
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// @ts-ignore
const buildTime = new Date().toISOString();

console.info("[BUILD]", {
  tag: "IMPORTSTATUS_FIX_FINAL",
  builtAt: buildTime,
  hosting: "cloudflare-pages"
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
