/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Roboto', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      colors: {
        primary: '#0f172a',    // Slate 900 - Fundo Profundo
        secondary: '#334155',  // Slate 700 - Texto Secundário/Ícones
        accent: '#0284c7',     // Sky 600 - Ações Primárias (Azul Técnico)
        surface: '#ffffff',    // Branco
        background: '#f8fafc', // Slate 50 - Fundo App
        success: '#10b981',    // Emerald 500 - Sucesso Discreto
        warning: '#f59e0b',    // Amber 500 - Alerta
        error: '#ef4444',      // Red 500 - Erro
        border: '#e2e8f0',     // Slate 200 - Bordas Sutis
      }
    },
  },
  plugins: [],
}
