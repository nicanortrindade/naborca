#!/bin/bash
exec > /tmp/results.txt 2>&1
set -ex

echo "=== PASSO 6: CONFIRMAR IMPORT-OCR-FALLBACK ==="
grep -n 'BUILD_SIG\|build_sig\|merge-wrapped' supabase/functions/import-ocr-fallback/index.ts | head -5 || echo "NONE"
grep -n 'max_chunks\|maxChunks\|maxBatches' supabase/functions/import-ocr-fallback/index.ts || echo "NONE"

echo "=== PASSO 7: DEPLOY ==="
git status
git add -A
git commit -m "revert: ocr-worker volta para código original — fix job travado batch 2/13" || echo "Nothing to commit"
GIT_TERMINAL_PROMPT=0 git push origin master || echo "Push fail"
git tag -a checkpoint-revert-full -m "Revert completo: ambas funções no estado do Utinga perfeito" || echo "Tag exists"
GIT_TERMINAL_PROMPT=0 git push origin checkpoint-revert-full || echo "Push tag fail"

source ~/.nvm/nvm.sh
npx supabase functions deploy ocr-worker
npx supabase functions deploy import-ocr-fallback

git log --oneline -5

echo "=== PASSO 8: VALIDAÇÃO ==="
grep -n 'max_chunks\|maxChunks' supabase/functions/ocr-worker/index.ts || echo "ZERO RESULTADOS ENCONTRADOS"
