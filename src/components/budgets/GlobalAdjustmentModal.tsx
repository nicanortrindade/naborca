
import React from 'react';
import { X, Calculator, Percent, DollarSign, ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';

interface GlobalAdjustmentModalProps {
    onClose: () => void;
    onApply: (mode: 'materials_only' | 'bdi_only' | 'global_all', type: 'percentage' | 'fixed', value: number, applyToAnalytic: boolean) => void;
    currentTotal: number;
}

const GlobalAdjustmentModal: React.FC<GlobalAdjustmentModalProps> = ({ onClose, onApply, currentTotal }) => {
    const [mode, setMode] = React.useState<'percentage' | 'fixed'>('percentage');
    const [adjustmentMode, setAdjustmentMode] = React.useState<'materials_only' | 'bdi_only' | 'global_all'>('materials_only');
    const [percentage, setPercentage] = React.useState<string>('0');
    const [fixedValue, setFixedValue] = React.useState<string>(currentTotal.toFixed(2).replace('.', ','));
    const [applyToAnalytic, setApplyToAnalytic] = React.useState(false);

    // Helper to format currency
    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    // Calculate preview based on current input - always rounded to 2 decimals
    const previewTotal = React.useMemo(() => {
        if (mode === 'percentage') {
            const pct = parseFloat(percentage.replace(',', '.')) || 0;
            return Math.round(currentTotal * (1 + pct / 100) * 100) / 100;
        } else {
            // Robust parsing for Brazilian numbers (1.234,56 -> 1234.56)
            const clean = fixedValue
                .replace(/\./g, '') // Remove thousands separator
                .replace(',', '.');  // Replace decimal separator
            return Math.round((parseFloat(clean) || 0) * 100) / 100;
        }
    }, [mode, percentage, fixedValue, currentTotal]);

    const difference = React.useMemo(() => {
        return Math.round((previewTotal - currentTotal) * 100) / 100;
    }, [previewTotal, currentTotal]);

    const handleApply = () => {
        if (mode === 'percentage') {
            const val = parseFloat(percentage.replace(',', '.')) || 0;
            onApply(adjustmentMode, 'percentage', val, applyToAnalytic);
        } else {
            if (previewTotal <= 0) {
                alert("Digite um valor fixo válido.");
                return;
            }
            onApply(adjustmentMode, 'fixed', previewTotal, applyToAnalytic);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6 text-white flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="bg-white/20 p-2 rounded-lg">
                            <Calculator size={24} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">Ajuste Global</h2>
                            <p className="text-blue-100 text-sm">Reajuste todos os itens do orçamento</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-white/80 hover:text-white hover:bg-white/10 p-2 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">
                    {/* Tabs */}
                    <div className="flex bg-slate-100 p-1 rounded-lg">
                        <button
                            onClick={() => setMode('percentage')}
                            className={clsx(
                                "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-2",
                                mode === 'percentage' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                            )}
                        >
                            <Percent size={16} />
                            Porcentagem (%)
                        </button>
                        <button
                            onClick={() => setMode('fixed')}
                            className={clsx(
                                "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-2",
                                mode === 'fixed' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                            )}
                        >
                            <DollarSign size={16} />
                            Valor Fixo (R$)
                        </button>
                    </div>

                    {/* Mode Selector */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Modo de Aplicação</label>
                        <div className="grid grid-cols-3 gap-2">
                            <button
                                onClick={() => setAdjustmentMode('materials_only')}
                                className={clsx(
                                    "p-2 rounded-lg border text-sm font-medium transition-all flex flex-col items-center gap-1",
                                    adjustmentMode === 'materials_only'
                                        ? "bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500"
                                        : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                                )}
                            >
                                <span>Materiais</span>
                                <span className="text-[10px] font-normal text-center opacity-80 leading-tight">Recomendado p/ Licitação</span>
                            </button>
                            <button
                                onClick={() => setAdjustmentMode('bdi_only')}
                                className={clsx(
                                    "p-2 rounded-lg border text-sm font-medium transition-all flex flex-col items-center gap-1",
                                    adjustmentMode === 'bdi_only'
                                        ? "bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500"
                                        : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                                )}
                            >
                                <span>BDI</span>
                                <span className="text-[10px] font-normal text-center opacity-80 leading-tight">Altera apenas lucros/despesas</span>
                            </button>
                            <button
                                onClick={() => setAdjustmentMode('global_all')}
                                className={clsx(
                                    "p-2 rounded-lg border text-sm font-medium transition-all flex flex-col items-center gap-1",
                                    adjustmentMode === 'global_all'
                                        ? "bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500"
                                        : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                                )}
                            >
                                <span>Global</span>
                                <span className="text-[10px] font-normal text-center opacity-80 leading-tight">Altera tudo (Cuidado)</span>
                            </button>
                        </div>
                    </div>

                    {/* Inputs */}
                    <div className="space-y-4">
                        {mode === 'percentage' ? (
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Ajuste Percentual</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={percentage}
                                        onChange={(e) => setPercentage(e.target.value)}
                                        className="w-full pl-4 pr-10 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg font-semibold text-slate-800"
                                        placeholder="0"
                                    />
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</div>
                                </div>
                                <p className="text-xs text-slate-500 mt-2">
                                    Use valores positivos para aumentar (ex: 10) ou negativos para diminuir (ex: -5).
                                </p>
                            </div>
                        ) : (
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Novo Valor Total</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">R$</span>
                                    <input
                                        type="text"
                                        value={fixedValue}
                                        onChange={(e) => setFixedValue(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg font-semibold text-slate-800"
                                        placeholder="0,00"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Analytic Propagation Options */}
                    <div className="bg-amber-50 p-4 rounded-xl border border-amber-200">
                        <h4 className="text-sm font-bold text-amber-900 mb-3 flex items-center gap-2">
                            <DollarSign size={16} /> Impacto na Analítica (Insumos)
                        </h4>

                        <label className="flex items-start gap-3 p-3 bg-white rounded-lg border border-amber-100 cursor-pointer hover:border-amber-300 transition-colors mb-2">
                            <input
                                type="radio"
                                name="analytic_mode"
                                checked={applyToAnalytic}
                                onChange={() => setApplyToAnalytic(true)}
                                className="mt-1 w-4 h-4 text-blue-600"
                            />
                            <div>
                                <span className="font-bold text-gray-800 text-sm block">Aplicar também na analítica</span>
                                <span className="text-xs text-gray-500">Reajusta o preço dos insumos proporcionalmente. Mantém a coerência (Sintético = Analítico).</span>
                            </div>
                        </label>

                        <label className="flex items-start gap-3 p-3 bg-white rounded-lg border border-amber-100 cursor-pointer hover:border-amber-300 transition-colors">
                            <input
                                type="radio"
                                name="analytic_mode"
                                checked={!applyToAnalytic}
                                onChange={() => setApplyToAnalytic(false)}
                                className="mt-1 w-4 h-4 text-blue-600"
                            />
                            <div>
                                <span className="font-bold text-gray-800 text-sm block">Aplicar somente no sintético</span>
                                <span className="text-xs text-gray-500">Analítica permanecerá com preços antigos. Gera divergência que precisará ser corrigida antes da licitação.</span>
                            </div>
                        </label>
                    </div>

                    {/* Impact Summary */}
                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Resumo do Impacto</h3>

                        <div className="flex items-center justify-between text-sm mb-2">
                            <span className="text-slate-600">Total Atual:</span>
                            <span className="font-medium text-slate-900">{formatCurrency(currentTotal)}</span>
                        </div>

                        <div className="flex items-center justify-between text-sm mb-3">
                            <span className="text-slate-600">Novo Total:</span>
                            <span className="font-bold text-blue-700 text-lg">{formatCurrency(previewTotal)}</span>
                        </div>

                        <div className="flex items-center justify-between text-xs pt-3 border-t border-slate-200">
                            <span className="text-slate-500">Diferença:</span>
                            <span className={clsx(
                                "font-bold flex items-center gap-1",
                                difference > 0 ? "text-green-600" : difference < 0 ? "text-red-600" : "text-slate-500"
                            )}>
                                {difference > 0 ? '+' : ''}{formatCurrency(difference)}
                            </span>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={onClose}
                            className="flex-1 px-4 py-3 text-slate-700 font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleApply}
                            className="flex-1 px-4 py-3 text-white font-medium bg-blue-600 rounded-lg hover:bg-blue-700 shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
                        >
                            Aplicar Ajuste
                            <ArrowRight size={18} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GlobalAdjustmentModal;
