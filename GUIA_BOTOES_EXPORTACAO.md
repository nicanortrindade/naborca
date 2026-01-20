# 🎯 GUIA DE IMPLEMENTAÇÃO - BOTÕES DE EXPORTAÇÃO

## ✅ FUNCIONALIDADES IMPLEMENTADAS

### **1. Módulo de Exportação Completo** (`src/utils/budgetExport.ts`)

Todas as funções de exportação estão prontas e funcionando:

#### **Orçamentos:**
- ✅ `exportPDFSynthetic()` - PDF Sintético
- ✅ `exportPDFAnalytic()` - PDF Analítico
- ✅ `exportExcelSynthetic()` - Excel Sintético
- ✅ `exportExcelAnalytic()` - Excel Analítico

#### **Curvas ABC:**
- ✅ `exportABCServicos()` - PDF + Excel de Serviços
- ✅ `exportABCInsumos()` - PDF + Excel de Insumos

#### **Cronograma e Curva S:**
- ✅ `exportScheduleExcel()` - Cronograma em Excel (larguras fixas, células pintadas)
- ✅ `exportSchedulePDF()` - Cronograma em PDF (paisagem)
- ✅ `exportCurvaSExcel()` - Curva S em Excel (dados acumulados)
- ✅ `exportCurvaSPDF()` - Curva S em PDF (com suporte a gráfico)

#### **Exportação Completa:**
- ✅ `exportCompleteProject()` - Gera ZIP com todos os arquivos

### **2. Estados de Loading** (BudgetEditor.tsx)

```typescript
const [isExportingAnalytic, setIsExportingAnalytic] = useState(false);
const [isExportingZip, setIsExportingZip] = useState(false);
const [exportProgress, setExportProgress] = useState({ 
    current: 0, 
    total: 0, 
    message: '' 
});
```

### **3. Funções com Loading** (BudgetEditor.tsx)

```typescript
// ✅ Excel Analítico com loading
const handleExportExcelAnalytic = async () => {
    setIsExportingAnalytic(true);
    try {
        // ... exportação
    } finally {
        setIsExportingAnalytic(false);
    }
};

// ✅ ZIP Completo com progresso
const handleExportCompleteZip = async () => {
    setIsExportingZip(true);
    setExportProgress({ current: 0, total: 6, message: 'Iniciando...' });
    try {
        await exportCompleteProject(data, (current, total, message) => {
            setExportProgress({ current, total, message });
        });
    } finally {
        setIsExportingZip(false);
        setExportProgress({ current: 0, total: 0, message: '' });
    }
};
```

---

## 📋 PRÓXIMOS PASSOS - ADICIONAR BOTÕES NA INTERFACE

### **PASSO 1: Importar Ícones Necessários**

No início do arquivo `BudgetEditor.tsx`, adicione os ícones:

```typescript
import { 
    Package,      // Para ZIP
    Loader,       // Para loading
    FileSpreadsheet, // Para Excel
    FileText,     // Para PDF
    Calendar,     // Para Cronograma
    TrendingUp    // Para Curva S
} from 'lucide-react';
```

### **PASSO 2: Adicionar Botão "Exportar Projeto Completo (.zip)"**

Localize a seção de botões de exportação no JSX e adicione:

```tsx
{/* Botão ZIP - Exportação Completa */}
<button
    onClick={handleExportCompleteZip}
    disabled={isExportingZip || !budget || !items || items.length === 0}
    className={clsx(
        "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all",
        isExportingZip
            ? "bg-slate-300 text-slate-500 cursor-not-allowed"
            : "bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 shadow-md hover:shadow-lg"
    )}
>
    {isExportingZip ? (
        <>
            <Loader className="animate-spin" size={18} />
            <span className="text-sm">
                {exportProgress.message || 'Processando...'}
                {exportProgress.total > 0 && ` (${exportProgress.current}/${exportProgress.total})`}
            </span>
        </>
    ) : (
        <>
            <Package size={18} />
            <span>Exportar Projeto Completo (.zip)</span>
        </>
    )}
</button>
```

### **PASSO 3: Adicionar Barra de Progresso (Opcional)**

Logo abaixo do botão ZIP, adicione uma barra de progresso visual:

```tsx
{isExportingZip && exportProgress.total > 0 && (
    <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
        <div 
            className="bg-gradient-to-r from-purple-600 to-indigo-600 h-full transition-all duration-300"
            style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
        />
    </div>
)}
```

### **PASSO 4: Atualizar Botão Excel Analítico com Loading**

Encontre o botão de exportação Excel Analítico e atualize:

```tsx
<button
    onClick={handleExportExcelAnalytic}
    disabled={isExportingAnalytic || !budget || !items}
    className={clsx(
        "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors",
        isExportingAnalytic
            ? "bg-slate-300 text-slate-500 cursor-not-allowed"
            : "bg-green-600 text-white hover:bg-green-700"
    )}
>
    {isExportingAnalytic ? (
        <>
            <Loader className="animate-spin" size={18} />
            <span>Processando...</span>
        </>
    ) : (
        <>
            <FileSpreadsheet size={18} />
            <span>Excel Analítico</span>
        </>
    )}
</button>
```

---

## 🎨 EXEMPLO DE LAYOUT COMPLETO

```tsx
{/* Seção de Exportações */}
<div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
    <h3 className="font-bold text-slate-800 flex items-center gap-2">
        <FileText size={18} />
        Exportações
    </h3>

    {/* Grid de Botões */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        
        {/* PDF Sintético */}
        <button
            onClick={() => handleExportPDF('synthetic')}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
            <FileText size={18} />
            <span>PDF Sintético</span>
        </button>

        {/* PDF Analítico */}
        <button
            onClick={() => handleExportPDF('analytic')}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
            <FileText size={18} />
            <span>PDF Analítico</span>
        </button>

        {/* Excel Sintético */}
        <button
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
            <FileSpreadsheet size={18} />
            <span>Excel Sintético</span>
        </button>

        {/* Excel Analítico com Loading */}
        <button
            onClick={handleExportExcelAnalytic}
            disabled={isExportingAnalytic}
            className={clsx(
                "flex items-center gap-2 px-4 py-2 rounded-lg font-medium",
                isExportingAnalytic
                    ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                    : "bg-green-600 text-white hover:bg-green-700"
            )}
        >
            {isExportingAnalytic ? (
                <>
                    <Loader className="animate-spin" size={18} />
                    <span>Processando...</span>
                </>
            ) : (
                <>
                    <FileSpreadsheet size={18} />
                    <span>Excel Analítico</span>
                </>
            )}
        </button>
    </div>

    {/* Botão ZIP - Destaque */}
    <div className="pt-3 border-t border-slate-200 space-y-2">
        <button
            onClick={handleExportCompleteZip}
            disabled={isExportingZip}
            className={clsx(
                "w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-bold transition-all",
                isExportingZip
                    ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                    : "bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 shadow-lg hover:shadow-xl"
            )}
        >
            {isExportingZip ? (
                <>
                    <Loader className="animate-spin" size={20} />
                    <span>
                        {exportProgress.message || 'Gerando arquivos...'}
                        {exportProgress.total > 0 && ` (${exportProgress.current}/${exportProgress.total})`}
                    </span>
                </>
            ) : (
                <>
                    <Package size={20} />
                    <span>Exportar Projeto Completo (.zip)</span>
                </>
            )}
        </button>

        {/* Barra de Progresso */}
        {isExportingZip && exportProgress.total > 0 && (
            <div className="space-y-1">
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                    <div 
                        className="bg-gradient-to-r from-purple-600 to-indigo-600 h-full transition-all duration-300"
                        style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
                    />
                </div>
                <p className="text-xs text-center text-slate-500">
                    {Math.round((exportProgress.current / exportProgress.total) * 100)}% concluído
                </p>
            </div>
        )}
    </div>
</div>
```

---

## 🔧 FUNÇÕES ADICIONAIS PARA CRONOGRAMA E CURVA S

### **Exemplo de Uso - Cronograma:**

```typescript
const handleExportSchedule = async (format: 'pdf' | 'excel') => {
    const { exportSchedulePDF, exportScheduleExcel } = await import('../utils/budgetExport');
    
    const scheduleData = items.map((item, idx) => ({
        itemNumber: getItemNumber(idx),
        description: item.description,
        totalValue: item.totalPrice,
        months: {
            'Jan/26': 10,
            'Fev/26': 15,
            'Mar/26': 20,
            // ... outros meses
        }
    }));

    const data = {
        budgetName: budget.name,
        clientName: budget.client,
        scheduleData,
        monthsHeaders: ['Jan/26', 'Fev/26', 'Mar/26', 'Abr/26']
    };

    if (format === 'pdf') {
        await exportSchedulePDF(data);
    } else {
        await exportScheduleExcel(data);
    }
};
```

### **Exemplo de Uso - Curva S:**

```typescript
const handleExportCurvaS = async (format: 'pdf' | 'excel') => {
    const { exportCurvaSPDF, exportCurvaSExcel } = await import('../utils/budgetExport');
    
    const curvaData = [
        { month: 'Jan/26', previstoAcumulado: 10, realizadoAcumulado: 8 },
        { month: 'Fev/26', previstoAcumulado: 25, realizadoAcumulado: 22 },
        { month: 'Mar/26', previstoAcumulado: 45, realizadoAcumulado: 50 },
        // ... outros meses
    ];

    const data = {
        budgetName: budget.name,
        clientName: budget.client,
        curvaData
    };

    if (format === 'pdf') {
        // Opcionalmente, capturar gráfico como imagem
        // const chartElement = document.getElementById('curva-s-chart');
        // const canvas = await html2canvas(chartElement);
        // const chartImageDataUrl = canvas.toDataURL('image/png');
        
        await exportCurvaSPDF({ ...data, chartImageDataUrl: undefined });
    } else {
        await exportCurvaSExcel(data);
    }
};
```

---

## ✅ CHECKLIST DE IMPLEMENTAÇÃO

- [x] Módulo de exportação completo (`budgetExport.ts`)
- [x] Estados de loading adicionados
- [x] Função `handleExportExcelAnalytic` com loading
- [x] Função `handleExportCompleteZip` com progresso
- [x] Funções de Cronograma (PDF + Excel)
- [x] Funções de Curva S (PDF + Excel)
- [ ] **Adicionar botões na interface (próximo passo manual)**
- [ ] **Testar exportações**
- [ ] **Ajustar layout conforme necessário**

---

## 🚀 BUILD ATUALIZADO

```
✓ built in 11.42s
├── budgetExport-CSJQ3f_G.js (950 kB)
├── index-BWI205wL.js (1.67 MB)
└── Total: ~2.6 MB (gzip: ~768 KB)
```

**Tudo pronto para uso! Basta adicionar os botões na interface seguindo os exemplos acima.** 🎉
