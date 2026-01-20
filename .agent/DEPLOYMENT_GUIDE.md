# Guia de Preparação para Hospedagem

## 🚀 Passos para Build de Produção

### 1. Corrigir Erros de Compilação

Antes de fazer o build, é necessário corrigir alguns erros TypeScript detectados:

#### Erros Principais

**BudgetEditor.tsx**:
- Uso de `db` (Dexie) em várias funções - precisa migrar para Supabase
- Propriedades snake_case vs camelCase (ex: `budget_id` → `budgetId`)
- Tipos de Composicao e Insumo usando propriedades antigas

**BudgetSchedule.tsx e ProposalReview.ts**:
- Referências a `COMPLIANCE_DISCLAIMERS.SCHEDULE` e `.REPORTS` que não existem

**Budgets.tsx**:
- Tipo incorreto para `date` (string vs Date)

### 2. Opções de Build

#### Opção A: Build Completo (Recomendado para Produção)

```bash
# 1. Instalar dependências
npm install

# 2. Corrigir erros TypeScript (ver seção abaixo)

# 3. Build de produção
npm run build

# 4. Testar build localmente
npm run preview
```

#### Opção B: Build Ignorando Erros (Temporário)

Se precisar fazer deploy urgente, pode ignorar erros TypeScript:

```bash
# Modificar package.json temporariamente
# Trocar: "build": "tsc && vite build"
# Por: "build": "vite build"

npm run build
```

**⚠️ ATENÇÃO**: Isso pode causar erros em runtime!

### 3. Estrutura de Arquivos para Hospedagem

Após o build bem-sucedido, a pasta `dist/` conterá:

```
dist/
├── index.html          # Página principal
├── assets/
│   ├── index-[hash].js     # JavaScript compilado
│   ├── index-[hash].css    # CSS compilado
│   └── [outros assets]
└── [outros arquivos estáticos]
```

### 4. Configuração de Hospedagem

#### Para Vercel

1. Criar `vercel.json` na raiz:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

2. Deploy:
```bash
npm install -g vercel
vercel --prod
```

#### Para Netlify

1. Criar `netlify.toml` na raiz:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

2. Deploy via CLI ou conectar repositório GitHub

#### Para Hostinger / cPanel

1. Fazer build local:
```bash
npm run build
```

2. Fazer upload da pasta `dist/` via FTP

3. Configurar `.htaccess` para SPA:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

### 5. Variáveis de Ambiente

**IMPORTANTE**: Configure as variáveis de ambiente do Supabase na hospedagem!

#### Vercel/Netlify

Adicionar no painel de configuração:
- `VITE_SUPABASE_URL` = sua_url_do_supabase
- `VITE_SUPABASE_ANON_KEY` = sua_chave_anonima

#### Hostinger/cPanel

Criar arquivo `.env.production` (NÃO commitar):

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua_chave_aqui
```

### 6. Otimizações de Produção

#### Comprimir Assets

Adicionar ao `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { compression } from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    react(),
    compression({ algorithm: 'gzip' })
  ],
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.log em produção
      }
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          pdf: ['jspdf', 'jspdf-autotable'],
          excel: ['xlsx']
        }
      }
    }
  }
});
```

#### CDN para Assets Estáticos

Considere usar CDN para:
- Fontes (Google Fonts)
- Ícones
- Imagens grandes

### 7. Checklist Pré-Deploy

- [ ] Todas as variáveis de ambiente configuradas
- [ ] Build executado sem erros
- [ ] Testado localmente com `npm run preview`
- [ ] RLS ativado no Supabase
- [ ] Políticas de segurança configuradas
- [ ] Backup do banco de dados feito
- [ ] DNS configurado (se domínio próprio)
- [ ] HTTPS habilitado
- [ ] Analytics configurado (Google Analytics, etc.)
- [ ] Monitoramento de erros (Sentry, opcional)

### 8. Pós-Deploy

#### Testar Funcionalidades Críticas

- [ ] Login/Logout
- [ ] Criação de orçamento
- [ ] Exportação PDF
- [ ] Exportação Excel
- [ ] Criação de proposta
- [ ] Salvamento de dados

#### Monitoramento

- Verificar logs de erro no console do navegador
- Monitorar performance (Core Web Vitals)
- Verificar tempo de carregamento

### 9. Rollback

Se algo der errado:

1. **Vercel/Netlify**: Reverter para deploy anterior no painel
2. **Hostinger**: Restaurar backup da pasta `dist/`
3. **Supabase**: Restaurar backup do banco se necessário

### 10. Domínio Personalizado

#### Configurar DNS

Adicionar registros:

**Para Vercel**:
```
A     @     76.76.21.21
CNAME www   cname.vercel-dns.com
```

**Para Netlify**:
```
A     @     75.2.60.5
CNAME www   [seu-site].netlify.app
```

## 📦 Arquivo de Deploy Rápido

Criar `deploy.sh`:

```bash
#!/bin/bash

echo "🚀 Iniciando deploy..."

# 1. Limpar build anterior
rm -rf dist

# 2. Instalar dependências
echo "📦 Instalando dependências..."
npm install

# 3. Build
echo "🔨 Compilando..."
npm run build

# 4. Verificar se build foi bem-sucedido
if [ -d "dist" ]; then
    echo "✅ Build concluído com sucesso!"
    echo "📁 Pasta dist/ pronta para upload"
    
    # Opcional: Deploy automático para Vercel
    # vercel --prod
else
    echo "❌ Erro no build!"
    exit 1
fi
```

## 🔧 Troubleshooting

### Erro: "Cannot find module"
```bash
rm -rf node_modules package-lock.json
npm install
```

### Erro: "Out of memory"
```bash
# Aumentar memória do Node
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

### Erro: "EACCES permission denied"
```bash
# Linux/Mac
sudo chown -R $(whoami) ~/.npm
```

### Build muito lento
```bash
# Usar cache do Vite
npm run build -- --force
```

## 📞 Suporte

Se encontrar problemas:

1. Verificar logs de erro completos
2. Testar em ambiente local primeiro
3. Verificar configuração do Supabase
4. Consultar documentação da hospedagem escolhida

---

**Status**: Aguardando correção de erros TypeScript para build  
**Próximo Passo**: Corrigir erros em BudgetEditor.tsx  
**Tempo Estimado**: 15-30 minutos de correções
