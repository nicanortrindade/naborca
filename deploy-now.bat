@echo off
echo ==========================================
echo   NABOORCA DEPLOY AUTOMATION
echo ==========================================
echo.
echo 1. Verificando Build...
call npm run build
if %errorlevel% neq 0 (
    echo [ERRO] Falha no Build. Corrija os erros antes de fazer deploy.
    pause
    exit /b %errorlevel%
)

echo.
echo 2. Iniciando Deploy para Cloudflare...
echo    (Se for a primeira vez, ira pedir para logar no navegador)
echo.
call npx wrangler pages deploy dist --project-name naborca --branch master

if %errorlevel% neq 0 (
    echo.
    echo [ERRO] O deploy falhou. Verifique se voce esta logado (npx wrangler login).
) else (
    echo.
    echo [SUCESSO] Deploy concluido!
)
pause
