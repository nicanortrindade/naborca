import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    '__BUILD_TIME__': JSON.stringify(new Date().toISOString()),
    '__COMMIT_SHA__': JSON.stringify(process.env.VITE_GIT_SHA || process.env.HEAD || 'dev-build')
  }
})
