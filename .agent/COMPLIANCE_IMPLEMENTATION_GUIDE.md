# Guia de Implementação - Compliance Jurídico

## 📋 Objetivo

Garantir que **NENHUM aviso, disclaimer ou texto explicativo** apareça em documentos oficiais exportados (PDFs, Excel, propostas), mantendo-os limpos e profissionais para envio a órgãos públicos.

## ⚖️ Diretriz Jurídica Obrigatória

> **CRÍTICO**: Documentos oficiais para licitações NÃO podem conter observações, avisos ou disclaimers do sistema. Apenas informações técnicas do edital devem estar presentes.

## ✅ Onde Exibir Avisos (PERMITIDO)

### 1. Interface do Sistema (UI)
- ✅ Banners no topo das páginas
- ✅ Cards informativos
- ✅ Seções de ajuda
- ✅ Tooltips em campos

### 2. Modais de Confirmação
- ✅ Antes de gerar PDF
- ✅ Antes de exportar Excel
- ✅ Antes de enviar proposta
- ✅ Ao salvar versões

### 3. Telas de Revisão
- ✅ Página de validação de proposta
- ✅ Página de comparação de orçamentos
- ✅ Página de simulação de cenários
- ✅ Página de análise de preços

### 4. Notificações e Alertas
- ✅ Toasts/Snackbars
- ✅ Alertas contextuais
- ✅ Mensagens de erro/sucesso

## ❌ Onde NUNCA Exibir Avisos (PROIBIDO)

### 1. PDFs Oficiais
- ❌ Rodapé de propostas
- ❌ Cabeçalho de orçamentos
- ❌ Corpo de relatórios técnicos
- ❌ Anexos de composições

### 2. Planilhas Excel
- ❌ Abas de dados
- ❌ Células de totais
- ❌ Comentários em células
- ❌ Cabeçalhos/rodapés

### 3. Documentos Impressos
- ❌ Cronogramas físico-financeiros
- ❌ Curvas ABC
- ❌ Memoriais de cálculo
- ❌ Relatórios de encargos

## 🛠️ Implementação

### Arquivos Criados

1. **`src/config/compliance.ts`**
   - Configuração centralizada de disclaimers
   - Mensagens de confirmação
   - Tooltips informativos
   - Funções auxiliares

2. **`src/components/ExportConfirmationModal.tsx`**
   - Modal de confirmação com checklist
   - Validação antes de exportar
   - Interface amigável e clara

3. **`src/components/ComplianceAlert.tsx`** (já existe)
   - Componente de alerta reutilizável
   - Usado em páginas de revisão

### Como Usar

#### 1. Exibir Aviso em Página de Revisão

```tsx
import ComplianceAlert from '../components/ComplianceAlert';
import { COMPLIANCE_DISCLAIMERS } from '../config/compliance';

function ProposalReviewPage() {
    return (
        <div>
            <ComplianceAlert
                type="warning"
                title={COMPLIANCE_DISCLAIMERS.LEGAL_COMPLIANCE.title}
                message={COMPLIANCE_DISCLAIMERS.LEGAL_COMPLIANCE.message}
            />
            {/* Resto da página */}
        </div>
    );
}
```

#### 2. Adicionar Confirmação Antes de Exportar

```tsx
import { useState } from 'react';
import ExportConfirmationModal from '../components/ExportConfirmationModal';
import { getExportConfirmation } from '../config/compliance';

function BudgetEditor() {
    const [showExportModal, setShowExportModal] = useState(false);
    
    const handleExportPDF = () => {
        setShowExportModal(true);
    };
    
    const confirmExport = () => {
        // Gerar PDF SEM avisos
        generateCleanPDF();
    };
    
    const exportConfig = getExportConfirmation('PDF_PROPOSAL');
    
    return (
        <>
            <button onClick={handleExportPDF}>
                Exportar PDF
            </button>
            
            <ExportConfirmationModal
                isOpen={showExportModal}
                onClose={() => setShowExportModal(false)}
                onConfirm={confirmExport}
                {...exportConfig}
            />
        </>
    );
}
```

#### 3. Adicionar Tooltip Informativo

```tsx
import { TOOLTIPS } from '../config/compliance';

function BDICalculator() {
    return (
        <div title={TOOLTIPS.BDI_CALCULATOR}>
            <input type="number" placeholder="BDI %" />
        </div>
    );
}
```

## 📝 Checklist de Implementação

### Páginas que Precisam de Avisos (UI)

- [x] **ProposalReview.tsx** - Já implementado
- [ ] **BudgetEditor.tsx** - Adicionar modal de confirmação
- [ ] **Proposals.tsx** - Adicionar modal antes de gerar PDF
- [ ] **BudgetComparison.tsx** - Adicionar disclaimer
- [ ] **ScenarioSimulator.tsx** - Adicionar aviso de uso interno
- [ ] **BudgetSchedule.tsx** - Adicionar modal de exportação

### Funções de Exportação que Precisam de Modal

- [ ] `handleExportPDF()` em BudgetEditor
- [ ] `handleExportExcel()` em BudgetEditor
- [ ] `handleExportExcelAnalytic()` em BudgetEditor
- [ ] `handleGenerateProposal()` em Proposals
- [ ] `handleDownloadPDF()` em Proposals
- [ ] Exportação de cronograma
- [ ] Exportação de curva ABC

### Verificação de Documentos Limpos

- [ ] Revisar `ProposalGenerator.ts` - garantir que NÃO há avisos
- [ ] Revisar `ScheduleGenerator.ts` - garantir que NÃO há avisos
- [ ] Revisar exportações Excel - garantir que NÃO há avisos
- [ ] Testar PDFs gerados - verificar ausência de disclaimers
- [ ] Testar Excel gerados - verificar ausência de disclaimers

## 🎯 Exemplos de Implementação

### Exemplo 1: Modal de Confirmação em BudgetEditor

```tsx
// Em BudgetEditor.tsx

import { useState } from 'react';
import ExportConfirmationModal from '../components/ExportConfirmationModal';
import { getExportConfirmation } from '../config/compliance';

const BudgetEditor = () => {
    const [exportModalType, setExportModalType] = useState<'PDF' | 'EXCEL' | null>(null);
    
    const handleExportPDF = () => {
        setExportModalType('PDF');
    };
    
    const handleExportExcel = () => {
        setExportModalType('EXCEL');
    };
    
    const confirmExport = () => {
        if (exportModalType === 'PDF') {
            // Gerar PDF LIMPO (sem avisos)
            generateProposalPDF(/* ... */);
        } else if (exportModalType === 'EXCEL') {
            // Gerar Excel LIMPO (sem avisos)
            generateExcelFile(/* ... */);
        }
        setExportModalType(null);
    };
    
    const exportConfig = exportModalType 
        ? getExportConfirmation(exportModalType === 'PDF' ? 'PDF_PROPOSAL' : 'EXCEL_BUDGET')
        : null;
    
    return (
        <>
            {/* Botões de exportação */}
            <button onClick={handleExportPDF}>PDF</button>
            <button onClick={handleExportExcel}>Excel</button>
            
            {/* Modal de confirmação */}
            {exportConfig && (
                <ExportConfirmationModal
                    isOpen={exportModalType !== null}
                    onClose={() => setExportModalType(null)}
                    onConfirm={confirmExport}
                    {...exportConfig}
                />
            )}
        </>
    );
};
```

### Exemplo 2: Disclaimer em Página de Comparação

```tsx
// Em BudgetComparison.tsx

import ComplianceAlert from '../components/ComplianceAlert';
import { COMPLIANCE_DISCLAIMERS } from '../config/compliance';

const BudgetComparison = () => {
    return (
        <div className="p-6 space-y-6">
            {/* Aviso no topo da página */}
            <ComplianceAlert
                type="info"
                title={COMPLIANCE_DISCLAIMERS.PRICE_COMPARISON.title}
                message={COMPLIANCE_DISCLAIMERS.PRICE_COMPARISON.message}
                compact
            />
            
            {/* Resto da página */}
            <div className="comparison-content">
                {/* ... */}
            </div>
        </div>
    );
};
```

### Exemplo 3: Tooltip em Campo Sensível

```tsx
// Em qualquer componente

import { TOOLTIPS } from '../config/compliance';

<div className="relative group">
    <input 
        type="number" 
        placeholder="BDI %"
        className="..."
    />
    <div className="absolute hidden group-hover:block bg-slate-800 text-white text-xs p-2 rounded-lg -top-12 left-0 w-64 z-10">
        {TOOLTIPS.BDI_CALCULATOR}
    </div>
</div>
```

## 🔍 Verificação de Conformidade

### Teste Manual

1. **Gerar PDF de Proposta**
   - ✅ Abrir PDF gerado
   - ✅ Verificar que NÃO há avisos/disclaimers
   - ✅ Verificar que APENAS dados técnicos estão presentes

2. **Exportar Excel**
   - ✅ Abrir arquivo Excel
   - ✅ Verificar todas as abas
   - ✅ Confirmar ausência de avisos

3. **Interface do Sistema**
   - ✅ Navegar para página de revisão
   - ✅ Confirmar que avisos APARECEM na UI
   - ✅ Verificar modais de confirmação

### Checklist de Auditoria

- [ ] Nenhum PDF contém disclaimers
- [ ] Nenhum Excel contém avisos
- [ ] Todos os modais de confirmação funcionam
- [ ] Avisos aparecem corretamente na UI
- [ ] Tooltips estão informativos
- [ ] Documentação está completa

## 📚 Referências

- **Arquivo de Configuração**: `src/config/compliance.ts`
- **Modal de Confirmação**: `src/components/ExportConfirmationModal.tsx`
- **Componente de Alerta**: `src/components/ComplianceAlert.tsx`
- **Guia de Implementação**: Este documento

## ⚠️ Avisos Importantes

1. **NUNCA adicione texto explicativo em funções de geração de PDF/Excel**
2. **SEMPRE use modais de confirmação antes de exportar**
3. **SEMPRE exiba disclaimers na UI, nunca nos documentos**
4. **TESTE todos os documentos exportados antes de enviar**

---

**Status**: ✅ Estrutura Implementada - Aguardando Integração nas Páginas  
**Última Atualização**: 2026-01-17  
**Responsável**: Compliance Jurídico - Licitações
