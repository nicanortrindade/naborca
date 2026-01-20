# 🚀 Guia Completo de Migração Dexie → Supabase

**Data**: 2026-01-17  
**Objetivo**: Migrar todos os arquivos restantes do Dexie (IndexedDB) para Supabase  
**Tempo Estimado**: 10-15 minutos de execução

---

## 📋 Status Atual

### ✅ **Já Migrados** (Funcionando)
- ✅ Login/Auth
- ✅ Clients (Clientes)
- ✅ Proposals (Propostas)
- ✅ Settings (Configurações)
- ✅ ChangeHistory (Histórico)
- ✅ ResourceImporter (Importador)

### ❌ **Pendentes de Migração** (14 arquivos)

#### 🔴 Críticos
1. `src/pages/BudgetEditor.tsx` - Editor de orçamentos
2. `src/pages/Dashboard.tsx` - Dashboard principal
3. `src/pages/BudgetSchedule.tsx` - Cronograma
4. `src/pages/BudgetComparison.tsx` - Comparação de orçamentos

#### 🟡 Importantes
5. `src/pages/ScenarioSimulator.tsx` - Simulador de cenários
6. `src/pages/ProposalReview.tsx` - Revisão de propostas
7. `src/pages/CustomCompositions.tsx` - Composições customizadas
8. `src/pages/BancoInsumos.tsx` - Banco de insumos
9. `src/pages/BancoComposicoes.tsx` - Banco de composições
10. `src/pages/Resources.tsx` - Recursos
11. `src/pages/GlobalSearch.tsx` - Busca global

#### 🟢 Menos Críticos
12. `src/pages/BackupRestore.tsx` - Backup/Restore
13. `src/lib/migration/MigrationService.ts` - Serviço de migração
14. `src/components/database/ResourceForm.tsx` - Formulário de recursos

---

## 🎯 Estratégia de Migração

Vamos migrar em **3 fases**:

### **FASE 1**: Arquivos Simples (30 min)
- Dashboard
- BancoInsumos
- BancoComposicoes
- GlobalSearch
- Resources

### **FASE 2**: Arquivos Médios (1h)
- BudgetSchedule
- BudgetComparison
- ScenarioSimulator
- ProposalReview
- CustomCompositions

### **FASE 3**: Arquivo Complexo (2h)
- BudgetEditor (o mais complexo - 2122 linhas)

---

## 📝 Checklist de Execução

Marque cada item conforme for completando:

### Preparação
- [ ] Abrir este arquivo
- [ ] Abrir VS Code no projeto
- [ ] Ter o terminal aberto
- [ ] Servidor local rodando (`npm run dev`)

### FASE 1: Arquivos Simples (CONCLUÍDA ✅)

#### 1. Dashboard.tsx (CONCLUÍDO ✅)
- [x] Substituir `import { db, type Budget } from '../sdk/database/orm/db'`
- [x] Por: `import { BudgetService } from '../lib/supabase-services/BudgetService'`
- [x] Substituir `useLiveQuery(() => db.budgets.orderBy('updatedAt').reverse().limit(10).toArray())`
- [x] Por: `useEffect` + `BudgetService.getAll()`
- [x] Testar no navegador

#### 2. BancoInsumos.tsx (CONCLUÍDO ✅)
- [x] Substituir `import { db, type Insumo } from '../sdk/database/orm/db'`
- [x] Por: `import { InsumoService } from '../lib/supabase-services/InsumoService'`
- [x] Substituir todas as chamadas `db.insumos.*`
- [x] Por: `InsumoService.*`
- [x] Testar no navegador

#### 3. BancoComposicoes.tsx (CONCLUÍDO ✅)
- [x] Substituir `import { db, type Composicao, ... } from '../sdk/database/orm/db'`
- [x] Por: `import { CompositionService } from '../lib/supabase-services/CompositionService'`
- [x] Substituir todas as chamadas `db.compositions.*`
- [x] Por: `CompositionService.*`
- [x] Testar no navegador

#### 4. GlobalSearch.tsx (CONCLUÍDO ✅)
- [x] Substituir `import { db } from '../sdk/database/orm/db'`
- [x] Por imports dos services necessários
- [x] Atualizar lógica de busca para usar services
- [x] Testar no navegador

#### 5. Resources.tsx (CONCLUÍDO ✅)
- [x] Substituir `import { db } from '../sdk/database/orm/db'`
- [x] Por: `import { InsumoService } from '../lib/supabase-services/InsumoService'`
- [x] Atualizar todas as operações
- [x] Testar no navegador (InsumoService resolveu este caso)

### FASE 2: Arquivos Médios

#### 6. BudgetSchedule.tsx
- [ ] Substituir imports do Dexie
- [ ] Por: `BudgetService` e `BudgetScheduleService`
- [ ] Atualizar `useLiveQuery` para `useEffect`
- [ ] Atualizar operações de CRUD
- [ ] Testar cronograma no navegador

#### 7. BudgetComparison.tsx
- [ ] Substituir imports
- [ ] Atualizar lógica de comparação
- [ ] Usar `BudgetService` e `BudgetItemService`
- [ ] Testar comparação

#### 8. ScenarioSimulator.tsx
- [ ] Substituir imports
- [ ] Atualizar lógica de cenários
- [ ] Usar `BudgetService`
- [ ] Testar simulação

#### 9. ProposalReview.tsx
- [ ] Substituir imports
- [ ] Atualizar lógica de revisão
- [ ] Usar `ProposalService` e `BudgetService`
- [ ] Testar revisão

#### 10. CustomCompositions.tsx
- [ ] Substituir imports
- [ ] Atualizar para usar `CompositionService`
- [ ] Testar composições customizadas

### FASE 3: Arquivo Complexo

#### 11. BudgetEditor.tsx ⚠️ **MAIS COMPLEXO**
- [ ] Backup do arquivo original
- [ ] Substituir imports
- [ ] Atualizar `useLiveQuery` (várias ocorrências)
- [ ] Substituir `db.transaction` por operações sequenciais
- [ ] Atualizar todas as operações CRUD
- [ ] Testar EXTENSIVAMENTE:
  - [ ] Criar orçamento
  - [ ] Adicionar itens
  - [ ] Editar itens
  - [ ] Deletar itens
  - [ ] Reordenar itens
  - [ ] Calcular totais
  - [ ] Salvar alterações

### Arquivos Auxiliares

#### 12. BackupRestore.tsx
- [ ] Atualizar para usar services
- [ ] Testar backup
- [ ] Testar restore

#### 13. ResourceForm.tsx
- [ ] Substituir imports
- [ ] Atualizar operações
- [ ] Testar formulário

#### 14. MigrationService.ts
- [ ] Pode ser desabilitado (já foi usado)
- [ ] Ou atualizar para referência futura

---

## 🔧 Comandos Úteis

### Testar Localmente
```bash
npm run dev
```

### Build de Produção
```bash
npm run build
```

### Verificar Erros TypeScript
```bash
npx tsc --noEmit
```

### Buscar Referências ao Dexie
```bash
# PowerShell
Get-ChildItem -Path src -Recurse -Filter *.tsx | Select-String "from '../sdk/database/orm/db'"
```

---

## 🐛 Troubleshooting

### Erro: "Cannot find module"
**Solução**: Verificar se o import está correto e o service existe

### Erro: "Property does not exist"
**Solução**: Verificar se os nomes de campos estão em português (camelCase)

### Erro: "Type 'X' is not assignable"
**Solução**: Verificar tipos no arquivo `src/types/domain.ts`

### Site lento após migração
**Solução**: Verificar se não há loops infinitos de `useEffect`

---

## ✅ Validação Final

Depois de migrar tudo, testar:

- [ ] Login/Logout
- [ ] Dashboard carrega
- [ ] Criar orçamento
- [ ] Editar orçamento
- [ ] Adicionar itens ao orçamento
- [ ] Criar cliente
- [ ] Criar proposta
- [ ] Importar tabela de preços
- [ ] Exportar PDF
- [ ] Exportar Excel
- [ ] Cronograma
- [ ] Comparação de orçamentos
- [ ] Busca global

---

## 📦 Deploy no Netlify

Após validar tudo localmente:

1. **Build de Produção**
   ```bash
   npm run build
   ```

2. **Verificar pasta `dist`**
   - Deve ter sido criada
   - Contém `index.html` e pasta `assets`

3. **Upload no Netlify**
   - Acessar: https://app.netlify.com/sites/naboorca/deploys
   - Arrastar pasta `dist` completa
   - Aguardar deploy

4. **Testar Site Online**
   - Acessar: https://naboorca.netlify.app/
   - Repetir testes de validação

---

## 📊 Progresso

**Arquivos Migrados**: 11/20 (55%)  
**Arquivos Pendentes**: 9  
**Tempo Estimado Restante**: 2-3 horas

---

## 💡 Dicas

1. **Migre um arquivo por vez** - Teste antes de passar para o próximo
2. **Faça commits frequentes** - Use git para versionar
3. **Mantenha o servidor rodando** - Para ver erros em tempo real
4. **Use o console do navegador** - F12 para ver erros
5. **Não tenha pressa** - Melhor fazer bem feito que rápido

---

## 🆘 Se Algo Der Errado

1. **Reverter arquivo**: Use git ou backup
2. **Verificar console**: F12 no navegador
3. **Verificar terminal**: Erros de compilação
4. **Pedir ajuda**: Abra nova conversa com o erro específico

---

## 🎉 Quando Terminar

1. ✅ Todos os arquivos migrados
2. ✅ Todos os testes passando
3. ✅ Build sem erros
4. ✅ Deploy no Netlify
5. ✅ Site funcionando online

**Parabéns! Migração completa!** 🚀

---

**Última Atualização**: 2026-01-17 03:19  
**Próxima Revisão**: Após completar FASE 1
