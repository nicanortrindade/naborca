import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// @ts-ignore
const buildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : new Date().toISOString();
// @ts-ignore
const commitSha = typeof __COMMIT_SHA__ !== 'undefined' ? __COMMIT_SHA__ : 'unknown';

console.log(`[BUILD] naborca.netlify.app version=0.1.0 commit=${commitSha} time=${buildTime} - CONTEXT: Prod Deployment`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
