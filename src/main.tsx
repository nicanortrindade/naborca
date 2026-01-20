import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

console.log(`[BUILD] naborca.netlify.app version=0.1.0 time=${new Date().toISOString()} - CONTEXT: Prod Deployment`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
