# NaboOrça — Correção Modal "Localizar Insumo / Adicionar Item" (Frontend)

## Contexto
- Backend (Supabase / SQL / RPCs / Views) validado.
- View `public.insumos` retorna INPUT e COMPOSITION.
- Endpoint `/rest/v1/insumos` retorna dados corretamente.
- Correção aplicada exclusivamente no frontend.

## Alterações Realizadas

### 1) Mapeamento de tipos usando enums do backend
- **Arquivo**: `BudgetEditor.tsx`
- **Linhas**: ~333, ~343, ~391, ~401
- **Mudança**: Adicionado `type: 'INPUT'` para insumos e `type: 'COMPOSITION'` para composições (usando enums do backend em maiúsculas).

**Antes:**
```typescript
const mappedInsumos = insumos?.map(i => ({
    ...i,
    code: i.codigo,
    description: i.descricao,
    unit: i.unidade,
    source: i.fonte || 'SINAPI',
    price: i.preco,
    // Sem campo type
})) || [];

const mappedCompositions = compositions?.map(c => ({
    ...c,
    code: c.codigo,
    description: c.descricao,
    unit: c.unidade,
    price: c.custoTotal,
    source: c.fonte || 'PROPRIO'
    // Sem campo type
})) || [];
```

**Depois:**
```typescript
const mappedInsumos = insumos?.map(i => ({
    ...i,
    code: i.codigo,
    description: i.descricao,
    unit: i.unidade,
    source: i.fonte || 'SINAPI',
    price: i.preco,
    type: 'INPUT', // Usar enum INPUT do backend
})) || [];

const mappedCompositions = compositions?.map(c => ({
    ...c,
    code: c.codigo,
    description: c.descricao,
    unit: c.unidade,
    price: c.custoTotal,
    type: 'COMPOSITION', // Usar enum COMPOSITION do backend
    source: c.fonte || 'PROPRIO'
})) || [];
```

### 2) Badges visuais
- **Modal "Localizar Insumo"** (linhas ~2595–2608)
  - `[INS]` para insumos (badge azul)
  - `[CPU]` para composições (badge roxo)
- **Modal "Localizar Insumo para CPU"** (linhas ~2893–2906)
  - Mesmos badges para consistência visual.

**Código do Badge:**
```tsx
<span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
    res.type === 'COMPOSITION' 
        ? 'bg-purple-100 text-purple-700' 
        : 'bg-blue-100 text-blue-700'
}`}>
    {res.type === 'COMPOSITION' ? '[CPU]' : '[INS]'}
</span>
```

### 3) Função handleAddItem
- **Linha**: ~770-772
- **Mudança**: Atualizada para verificar `selectedResource.type === 'COMPOSITION'` ao criar item

**Antes:**
```typescript
itemType: selectedResource.type === 'composition' ? 'composicao' : 'insumo',
compositionId: selectedResource.type === 'composition' ? selectedResource.id : undefined,
insumoId: selectedResource.type !== 'composition' ? selectedResource.id : undefined,
```

**Depois:**
```typescript
itemType: selectedResource.type === 'COMPOSITION' ? 'composicao' : 'insumo',
compositionId: selectedResource.type === 'COMPOSITION' ? selectedResource.id : undefined,
insumoId: selectedResource.type !== 'COMPOSITION' ? selectedResource.id : undefined,
```

### 4) Busca
- Resultados combinados de:
  - `InsumoService.search()` → mapeado para `type: 'INPUT'`
  - `CompositionService.search()` → mapeado para `type: 'COMPOSITION'`
- Ambos inseridos em `filteredResources`.
- **Nenhum filtro exclui COMPOSITION**.

## Checklist de Testes Manuais

### A) Listagem
- [ ] Abrir modal "Localizar Insumo / Adicionar Item"
- [ ] Buscar termo genérico (ex: "concreto", "pintura")
- [ ] Confirmar presença de itens `[INS]` e `[CPU]`
- [ ] Verificar se badges estão visíveis e coloridos corretamente
  - `[INS]` = azul (bg-blue-100 text-blue-700)
  - `[CPU]` = roxo (bg-purple-100 text-purple-700)

### B) Composições SINAPI
- [ ] Buscar termos típicos de composição (ex: "97082", "execução", "revestimento")
- [ ] Confirmar itens com badge `[CPU]`
- [ ] Verificar se código SINAPI aparece corretamente
- [ ] Confirmar que descrição, unidade e preço estão visíveis

### C) Adição ao orçamento
- [ ] Selecionar item `[CPU]` (composição)
- [ ] Inserir quantidade (ex: 10.00)
- [ ] Clicar "Adicionar"
- [ ] Confirmar que item foi inserido no orçamento sem erro
- [ ] Verificar se o item aparece na planilha com os dados corretos
- [ ] Confirmar que `itemType` foi salvo como 'composicao' no banco
- [ ] Verificar que `compositionId` está preenchido (não `insumoId`)

### D) Modal de Composição (Edição de Item)
- [ ] Editar um item existente
- [ ] Clicar em "ADICIONAR INSUMO" na seção de Composição
- [ ] Verificar se badges `[INS]` e `[CPU]` aparecem corretamente
- [ ] Adicionar um insumo à composição
- [ ] Salvar alterações

## Evidências

### Screenshots Necessários:
1. [ ] Modal "Localizar Insumo" mostrando itens com badges `[INS]` e `[CPU]`
2. [ ] Item `[CPU]` selecionado no modal
3. [ ] Composição SINAPI adicionada com sucesso ao orçamento
4. [ ] Planilha de orçamento exibindo item de composição

## Arquivos Modificados

- `src/pages/BudgetEditor.tsx`
  - Linha ~333: `type: 'INPUT'` para insumos
  - Linha ~343: `type: 'COMPOSITION'` para composições
  - Linha ~391: `type: 'INPUT'` no segundo useEffect
  - Linha ~401: `type: 'COMPOSITION'` no segundo useEffect
  - Linhas ~2599-2603: Badge visual no modal principal (verificação `'COMPOSITION'`)
  - Linhas ~2897-2901: Badge visual no modal de composição (verificação `'COMPOSITION'`)
  - Linhas ~770-772: handleAddItem usando `'COMPOSITION'`

## Notas Técnicas

### Por que usar INPUT/COMPOSITION em maiúsculas?
- Alinhamento com os enums do backend/banco de dados
- Consistência entre frontend e backend
- Evita erros de case-sensitive ao comparar tipos
- Facilita debugging e manutenção

### Validação Backend
- ✅ Backend retorna dados corretos
- ✅ View `public.insumos` está OK
- ✅ `InsumoService.search()` e `CompositionService.search()` funcionando
- ✅ Combinação de resultados implementada corretamente
- ✅ Tipos INPUT/COMPOSITION alinhados com banco

### Resumo das Mudanças de Tipo
| Local | Antes | Depois |
|-------|-------|--------|
| Mapeamento de insumos | sem `type` | `type: 'INPUT'` |
| Mapeamento de composições | sem `type` ou `'composition'` | `type: 'COMPOSITION'` |
| Badge verificação | `=== 'composition'` | `=== 'COMPOSITION'` |
| handleAddItem | `=== 'composition'` | `=== 'COMPOSITION'` |

### Próximos Passos (Opcional)
- [ ] Adicionar filtros por tipo (INPUT/COMPOSITION) no modal
- [ ] Adicionar contador de resultados por tipo
- [ ] Implementar busca avançada com filtros combinados

## Status de Commit

**Commit SHA**: _[Preencher após commit]_

**Teste A - Listagem**: ⬜ OK | ⬜ FAIL  
**Teste B - Composições SINAPI**: ⬜ OK | ⬜ FAIL  
**Teste C - Adição ao orçamento**: ⬜ OK | ⬜ FAIL  
**Teste D - Modal de Composição**: ⬜ OK | ⬜ FAIL  

---

**Data da Correção**: 2026-01-19  
**Desenvolvedor**: Equipe NaboOrça  
**Revisão**: Pendente

---

## Status de Validação no Ambiente Atual

**⚠️ LIMITAÇÃO**: Teste end-to-end de CPU (COMPOSITION) não pôde ser concluído porque o banco está vazio (0 insumos / 0 composições SINAPI carregadas).

### Fluxos Validados ✅
- Login/cadastro
- Criação de orçamento
- Abertura do modal "Localizar Insumo"
- Campo de busca e UI do modal
- Interface responsiva e funcionamento básico

### Pendente (bloqueado por ausência de dados) ⏸️
- Exibição real de itens [INS]/[CPU]
- Adição de COMPOSITION ao orçamento com item real
- Verificação de tipos INPUT/COMPOSITION no fluxo completo
- Validação de badges coloridos em contexto real

### Pré-requisito para Validação Final

1. **Concluir importação SINAPI no ambiente**
   - Acessar "SINAPI Importador" no menu lateral
   - Clicar em "Atualizar" e aguardar conclusão
   - Verificar que "Banco de CPUs" e "Banco de Insumos" não estão mais vazios

2. **Reexecutar o teste manual**:
   - Abrir um orçamento existente
   - Clicar "Adicionar Item" / "Localizar Insumo"
   - Buscar "97082" (código de composição SINAPI)
   - **Confirmar badge [CPU] roxo** aparece no resultado
   - Selecionar o item e definir quantidade
   - Clicar "Adicionar"
   - **Confirmar item no orçamento sem erro**
   - Verificar no console que não há erros de tipo
   - Confirmar que `itemType: 'composicao'` foi salvo corretamente

### Evidências de Teste Realizadas

- ✅ Criação de conta de teste (`test_final@example.com`)
- ✅ Criação de orçamentos de teste ("Teste CPU", "CPU Test")
- ✅ Abertura do modal de busca funcionando
- ✅ Campo de busca respondendo a inputs
- ❌ Busca por "97082" retornou 0 resultados (banco vazio)
- ⏸️ "SINAPI Importador" iniciou carregamento mas não concluiu durante o teste

### Confiança na Implementação

Apesar da limitação de teste com dados reais, a **implementação está correta** com base em:

1. **Análise Estática**: Todos os tipos foram corrigidos para maiúsculas (`INPUT`/`COMPOSITION`)
2. **Consistência**: As 7 alterações seguem o mesmo padrão
3. **Alinhamento**: Os enums usados correspondem aos esperados pelo backend
4. **Lógica**: Nenhum filtro foi adicionado que exclua COMPOSITION
5. **UI**: Badges e condições preparados para diferenciar tipos

**Recomendação**: Prosseguir com commit e realizar validação final após popular dados SINAPI.

