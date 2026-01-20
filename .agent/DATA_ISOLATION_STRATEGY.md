# Estratégia de Isolamento de Dados por Usuário

## Objetivo
Garantir isolamento total de dados por usuário, preparando o sistema para evolução como produto SaaS multi-tenant.

## Status Atual

### ✅ Tabelas com `user_id` Implementado
Todas as tabelas principais já possuem a coluna `user_id`:
- `companies` - Empresas do usuário
- `budgets` - Orçamentos
- `budget_items` - Itens de orçamento
- `insumos` - Insumos personalizados
- `compositions` - Composições personalizadas
- `clients` - Clientes
- `proposals` - Propostas
- `change_logs` - Logs de alteração
- `budget_schedules` - Cronogramas

### ⚠️ Problemas Identificados

#### 1. **Services NÃO Filtram por `user_id` nas Consultas**
**Problema Crítico**: Os métodos `getAll()` e `search()` retornam dados de TODOS os usuários.

**Exemplo em BudgetService.ts (linha 71-78)**:
```typescript
async getAll(): Promise<Budget[]> {
    const { data, error } = await supabase
        .from('budgets')
        .select('*')
        .order('updated_at', { ascending: false });
    // ❌ FALTA: .eq('user_id', user.id)
```

**Exemplo em InsumoService.ts (linha 106-114)**:
```typescript
async search(query: string): Promise<Insumo[]> {
    const { data, error } = await supabase
        .from('insumos')
        .select('*')
        .ilike('descricao', `%${query}%`)
        .limit(50);
    // ❌ FALTA: .eq('user_id', user.id)
```

#### 2. **Falta Row Level Security (RLS) no Supabase**
Mesmo com filtros no código, sem RLS no banco, um usuário mal-intencionado pode:
- Acessar dados de outros usuários via API direta
- Modificar dados que não lhe pertencem
- Deletar recursos de terceiros

#### 3. **Estrutura Multi-Empresa Não Implementada**
- Tabela `companies` existe mas não há seleção de empresa ativa
- Não há contexto de empresa nos services
- Não há UI para gerenciar múltiplas empresas

## Plano de Implementação

### FASE 1: Correção Imediata - Filtros de Segurança nos Services ⚡

**Prioridade: CRÍTICA**

Atualizar TODOS os services para filtrar por `user_id`:

#### 1.1. BudgetService
```typescript
async getAll(): Promise<Budget[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    
    const { data, error } = await supabase
        .from('budgets')
        .select('*')
        .eq('user_id', user.id)  // ✅ ADICIONAR
        .order('updated_at', { ascending: false });
```

#### 1.2. InsumoService
```typescript
async getAll(): Promise<Insumo[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    
    const { data, error } = await supabase
        .from('insumos')
        .select('*')
        .eq('user_id', user.id)  // ✅ ADICIONAR
        .order('descricao', { ascending: true });

async search(query: string): Promise<Insumo[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    
    const { data, error } = await supabase
        .from('insumos')
        .select('*')
        .eq('user_id', user.id)  // ✅ ADICIONAR
        .ilike('descricao', `%${query}%`)
        .limit(50);
```

#### 1.3. Aplicar em TODOS os Services
- ✅ BudgetService
- ✅ BudgetItemService (já filtra via `budget_id` que pertence ao user)
- ✅ InsumoService
- ✅ CompositionService
- ✅ ClientService
- ✅ ProposalService
- ✅ ChangeLogService
- ✅ BudgetScheduleService
- ✅ CompanyService (já implementado corretamente)

### FASE 2: Row Level Security (RLS) no Supabase 🔒

**Prioridade: ALTA**

Criar políticas RLS para TODAS as tabelas:

```sql
-- Exemplo para tabela budgets
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

-- Política de SELECT: usuário só vê seus próprios dados
CREATE POLICY "Users can view own budgets"
ON budgets FOR SELECT
USING (auth.uid() = user_id);

-- Política de INSERT: usuário só cria com seu próprio user_id
CREATE POLICY "Users can insert own budgets"
ON budgets FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Política de UPDATE: usuário só atualiza seus próprios dados
CREATE POLICY "Users can update own budgets"
ON budgets FOR UPDATE
USING (auth.uid() = user_id);

-- Política de DELETE: usuário só deleta seus próprios dados
CREATE POLICY "Users can delete own budgets"
ON budgets FOR DELETE
USING (auth.uid() = user_id);
```

**Aplicar para todas as tabelas**:
- budgets
- budget_items
- insumos
- compositions
- composition_items
- clients
- proposals
- change_logs
- budget_schedules
- companies

### FASE 3: Estrutura Multi-Empresa (Futuro) 🏢

**Prioridade: MÉDIA**

#### 3.1. Adicionar Contexto de Empresa
```typescript
// src/contexts/CompanyContext.tsx
export const CompanyContext = createContext<{
    activeCompany: CompanySettings | null;
    companies: CompanySettings[];
    setActiveCompany: (id: string) => void;
}>(null);
```

#### 3.2. Atualizar Services para Aceitar `company_id`
```typescript
// Exemplo: BudgetService
async getAll(companyId?: string): Promise<Budget[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    
    let query = supabase
        .from('budgets')
        .select('*')
        .eq('user_id', user.id);
    
    if (companyId) {
        query = query.eq('company_id', companyId);
    }
    
    const { data, error } = await query.order('updated_at', { ascending: false });
    // ...
}
```

#### 3.3. UI para Seleção de Empresa
- Dropdown no header para trocar empresa ativa
- Página de gerenciamento de empresas
- Wizard de criação de nova empresa

### FASE 4: Auditoria e Validação 🔍

**Prioridade: ALTA**

#### 4.1. Testes de Segurança
- [ ] Criar 2 usuários de teste
- [ ] Verificar que User A não vê dados de User B
- [ ] Tentar acessar dados via API direta
- [ ] Validar que RLS bloqueia acessos não autorizados

#### 4.2. Code Review
- [ ] Revisar TODOS os services
- [ ] Verificar que não há queries diretas sem filtro de user_id
- [ ] Validar que `getById()` também verifica ownership

#### 4.3. Documentação
- [ ] Documentar políticas de segurança
- [ ] Criar guia de desenvolvimento seguro
- [ ] Documentar estrutura multi-empresa

## Checklist de Implementação Imediata

### Services a Corrigir (FASE 1)
- [ ] BudgetService.getAll()
- [ ] BudgetService.getById() - adicionar verificação de ownership
- [ ] InsumoService.getAll()
- [ ] InsumoService.search()
- [ ] InsumoService.getById()
- [ ] CompositionService.getAll()
- [ ] CompositionService.getById()
- [ ] ClientService.getAll()
- [ ] ClientService.getById()
- [ ] ProposalService.getAll()
- [ ] ProposalService.getById()
- [ ] ChangeLogService.getByBudgetId() - verificar via budget ownership
- [ ] ChangeLogService.getByProposalId() - verificar via proposal ownership
- [ ] BudgetScheduleService.getByBudgetId() - verificar via budget ownership

### SQL Scripts para RLS (FASE 2)
- [ ] Criar script de migração com todas as políticas RLS
- [ ] Testar em ambiente de desenvolvimento
- [ ] Aplicar em produção

## Notas Importantes

1. **Backward Compatibility**: A adição de filtros `user_id` não quebra código existente
2. **Performance**: Índices em `user_id` já devem existir (verificar)
3. **Migration**: Dados existentes precisam ter `user_id` populado
4. **Testing**: Criar suite de testes de segurança

## Próximos Passos

1. ✅ Implementar filtros `user_id` em todos os services (FASE 1)
2. ✅ Criar e aplicar políticas RLS (FASE 2)
3. ⏳ Implementar contexto multi-empresa (FASE 3 - futuro)
4. ✅ Executar auditoria de segurança (FASE 4)

---

**Data de Criação**: 2026-01-17  
**Última Atualização**: 2026-01-17  
**Status**: 🔴 CRÍTICO - Implementação Imediata Necessária
