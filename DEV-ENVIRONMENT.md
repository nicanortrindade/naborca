# Ambiente de Desenvolvimento Local

**Data de configuração:** 22 Março 2026
**Branch:** fix/pipeline-v7

## Pré-requisitos instalados

- Node.js v24.12.0
- npm 11.6.2
- WSL2 2.6.3.0 (kernel 6.6.87.2-1)
- Docker Desktop 4.65.0 (engine 29.2.1)
- Supabase CLI 2.83.0 (via npx)

## Como subir o ambiente local

```bash
# 1. Abrir Docker Desktop (esperar baleia ficar verde)
# 2. No terminal, na pasta do projeto:
npx supabase start
```

## Endpoints locais

| Serviço | URL |
| :--- | :--- |
| Supabase Studio | http://127.0.0.1:54323 |
| API | http://127.0.0.1:54321 |
| DB (PostgreSQL) | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
| Inbucket (emails) | http://127.0.0.1:54324 |

## Schema

Schema copiado do banco remoto (`cgebiryqfqheyazwtzzm`) via `npx supabase db dump`. 39 tabelas, estrutura idêntica à produção. Dados vazios (fresh start).

## Regras

- Nunca rodar `supabase db push` sem antes confirmar que o target é LOCAL
- Nunca alterar o banco remoto a partir deste ambiente
- Todas as correções são feitas nesta branch (`fix/pipeline-v7`)
- Cada fix = 1 commit = 1 teste local antes de merge
- **Utinga** E **Araci** devem passar nos testes antes de qualquer merge na master

## Parar o ambiente

```bash
npx supabase stop
```

## Resetar o banco local (limpar tudo e recomeçar)

```bash
npx supabase db reset
```
