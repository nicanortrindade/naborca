
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Budget, BudgetItem } from '../types/domain';
import { BudgetService } from '../lib/supabase-services/BudgetService';
import { BudgetItemService } from '../lib/supabase-services/BudgetItemService';
import { GitCompare, ArrowLeft, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle } from 'lucide-react';
import ComplianceAlert from '../components/ComplianceAlert';
import { COMPLIANCE_DISCLAIMERS } from '../config/compliance';

const BudgetComparison: React.FC = () => {
    const navigate = useNavigate();
    const [budgets, setBudgets] = useState<Budget[]>([]);

    const [budgetA, setBudgetA] = useState<string | null>(null);
    const [budgetB, setBudgetB] = useState<string | null>(null);
    const [itemsA, setItemsA] = useState<BudgetItem[]>([]);
    const [itemsB, setItemsB] = useState<BudgetItem[]>([]);
    const [budgetDataA, setBudgetDataA] = useState<Budget | null>(null);
    const [budgetDataB, setBudgetDataB] = useState<Budget | null>(null);
    const [showDisclaimer, setShowDisclaimer] = useState(true);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const fetchBudgets = async () => {
            try {
                const data = await BudgetService.getAll();
                setBudgets(data.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
            } catch (error) {
                console.error('Error fetching budgets:', error);
            }
        };
        fetchBudgets();
    }, []);

    useEffect(() => {
        if (budgetA) {
            BudgetService.getById(budgetA).then(setBudgetDataA);
            BudgetItemService.getByBudgetId(budgetA).then(items =>
                setItemsA(items.sort((a, b) => a.order - b.order))
            );
        } else {
            setItemsA([]);
            setBudgetDataA(null);
        }
    }, [budgetA]);

    useEffect(() => {
        if (budgetB) {
            BudgetService.getById(budgetB).then(setBudgetDataB);
            BudgetItemService.getByBudgetId(budgetB).then(items =>
                setItemsB(items.sort((a, b) => a.order - b.order))
            );
        } else {
            setItemsB([]);
            setBudgetDataB(null);
        }
    }, [budgetB]);

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    // Compare items by code
    const compareItems = () => {
        const comparison: {
            code: string;
            description: string;
            inA: BudgetItem | null;
            inB: BudgetItem | null;
            priceDiff: number;
            qtyDiff: number;
        }[] = [];

        const allCodes = new Set([
            ...itemsA.filter(i => i.type !== 'group').map(i => i.code),
            ...itemsB.filter(i => i.type !== 'group').map(i => i.code)
        ]);

        allCodes.forEach(code => {
            const itemA = itemsA.find(i => i.code === code);
            const itemB = itemsB.find(i => i.code === code);

            const priceA = itemA?.totalPrice || 0;
            const priceB = itemB?.totalPrice || 0;
            const qtyA = itemA?.quantity || 0;
            const qtyB = itemB?.quantity || 0;

            comparison.push({
                code,
                description: itemA?.description || itemB?.description || '',
                inA: itemA || null,
                inB: itemB || null,
                priceDiff: priceB - priceA,
                qtyDiff: qtyB - qtyA
            });
        });

        return comparison.sort((a, b) => Math.abs(b.priceDiff) - Math.abs(a.priceDiff));
    };

    const comparisonData = budgetA && budgetB ? compareItems() : [];
    const totalA = budgetDataA?.totalValue || 0;
    const totalB = budgetDataB?.totalValue || 0;
    const totalDiff = totalB - totalA;
    const totalDiffPercent = totalA > 0 ? (totalDiff / totalA) * 100 : 0;

    return (
        <div className="p-6">
            <header className="mb-6">
                <button
                    onClick={() => navigate('/budgets')}
                    className="flex items-center gap-2 text-slate-500 hover:text-slate-800 mb-4"
                >
                    <ArrowLeft size={16} /> Voltar
                </button>
                <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                    <GitCompare className="text-blue-600" />
                    Comparação de Orçamentos
                </h1>
                <p className="text-slate-500 mt-2">
                    Compare dois orçamentos lado a lado para identificar diferenças de preço e itens.
                </p>
            </header>

            {/* Compliance Disclaimer */}
            {showDisclaimer && (
                <div className="mb-6">
                    <ComplianceAlert
                        type="warning"
                        title={COMPLIANCE_DISCLAIMERS.LEGAL_COMPLIANCE.title}
                        message={COMPLIANCE_DISCLAIMERS.LEGAL_COMPLIANCE.message}
                        recommendation={"Revise tecnicamente os orçamentos antes da decisão final."}
                        dismissable
                        onDismiss={() => setShowDisclaimer(false)}
                    />
                </div>
            )}

            {/* Budget Selection */}
            <div className="grid grid-cols-2 gap-6 mb-8">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                        Orçamento Base (A)
                    </label>
                    <select
                        value={budgetA || ''}
                        onChange={(e) => setBudgetA(e.target.value || null)}
                        className="w-full p-3 border-2 border-slate-200 rounded-xl font-medium focus:border-blue-500 outline-none"
                    >
                        <option value="">Selecione um orçamento</option>
                        {budgets?.filter(b => b.id !== budgetB).map(b => (
                            <option key={b.id} value={b.id}>{b.name} - {b.client}</option>
                        ))}
                    </select>
                    {budgetDataA && (
                        <div className="mt-4 p-4 bg-blue-50 rounded-xl">
                            <p className="text-sm text-blue-600 font-medium">{itemsA.length} itens</p>
                            <p className="text-2xl font-black text-blue-700">{formatCurrency(totalA)}</p>
                        </div>
                    )}
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                        Orçamento Comparado (B)
                    </label>
                    <select
                        value={budgetB || ''}
                        onChange={(e) => setBudgetB(e.target.value || null)}
                        className="w-full p-3 border-2 border-slate-200 rounded-xl font-medium focus:border-blue-500 outline-none"
                    >
                        <option value="">Selecione um orçamento</option>
                        {budgets?.filter(b => b.id !== budgetA).map(b => (
                            <option key={b.id} value={b.id}>{b.name} - {b.client}</option>
                        ))}
                    </select>
                    {budgetDataB && (
                        <div className="mt-4 p-4 bg-green-50 rounded-xl">
                            <p className="text-sm text-green-600 font-medium">{itemsB.length} itens</p>
                            <p className="text-2xl font-black text-green-700">{formatCurrency(totalB)}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Summary */}
            {budgetA && budgetB && (
                <div className={`mb-8 p-6 rounded-xl flex items-center justify-between ${totalDiff > 0 ? 'bg-red-50 border border-red-200' : totalDiff < 0 ? 'bg-green-50 border border-green-200' : 'bg-slate-50 border border-slate-200'}`}>
                    <div>
                        <p className="text-sm font-bold uppercase tracking-wider text-slate-500">Diferença Total</p>
                        <p className={`text-3xl font-black ${totalDiff > 0 ? 'text-red-600' : totalDiff < 0 ? 'text-green-600' : 'text-slate-600'}`}>
                            {totalDiff > 0 ? '+' : ''}{formatCurrency(totalDiff)}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        {totalDiff > 0 ? <TrendingUp size={32} className="text-red-500" /> :
                            totalDiff < 0 ? <TrendingDown size={32} className="text-green-500" /> :
                                <Minus size={32} className="text-slate-400" />}
                        <span className={`text-2xl font-bold ${totalDiff > 0 ? 'text-red-600' : totalDiff < 0 ? 'text-green-600' : 'text-slate-600'}`}>
                            {totalDiffPercent > 0 ? '+' : ''}{totalDiffPercent.toFixed(2)}%
                        </span>
                    </div>
                </div>
            )}

            {/* Comparison Table */}
            {comparisonData.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="p-4 text-left text-xs font-bold text-slate-500 uppercase">Status</th>
                                <th className="p-4 text-left text-xs font-bold text-slate-500 uppercase">Código</th>
                                <th className="p-4 text-left text-xs font-bold text-slate-500 uppercase">Descrição</th>
                                <th className="p-4 text-right text-xs font-bold text-slate-500 uppercase">Total (A)</th>
                                <th className="p-4 text-right text-xs font-bold text-slate-500 uppercase">Total (B)</th>
                                <th className="p-4 text-right text-xs font-bold text-slate-500 uppercase">Diferença</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {comparisonData.map((item, idx) => (
                                <tr key={idx} className="hover:bg-slate-50">
                                    <td className="p-4">
                                        {!item.inA ? (
                                            <span className="flex items-center gap-1 text-green-600 text-xs font-bold">
                                                <CheckCircle size={14} /> Novo em B
                                            </span>
                                        ) : !item.inB ? (
                                            <span className="flex items-center gap-1 text-red-600 text-xs font-bold">
                                                <AlertTriangle size={14} /> Removido
                                            </span>
                                        ) : item.priceDiff !== 0 ? (
                                            <span className={`flex items-center gap-1 text-xs font-bold ${item.priceDiff > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                                {item.priceDiff > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                                Alterado
                                            </span>
                                        ) : (
                                            <span className="text-slate-400 text-xs"><Minus size={14} /></span>
                                        )}
                                    </td>
                                    <td className="p-4 font-mono text-slate-600">{item.code}</td>
                                    <td className="p-4 text-sm text-slate-700 max-w-xs truncate">{item.description}</td>
                                    <td className="p-4 text-right font-medium text-slate-600">
                                        {item.inA ? formatCurrency(item.inA.totalPrice) : '-'}
                                    </td>
                                    <td className="p-4 text-right font-medium text-slate-600">
                                        {item.inB ? formatCurrency(item.inB.totalPrice) : '-'}
                                    </td>
                                    <td className={`p-4 text-right font-bold ${item.priceDiff > 0 ? 'text-red-600' : item.priceDiff < 0 ? 'text-green-600' : 'text-slate-400'}`}>
                                        {item.priceDiff !== 0 ? (item.priceDiff > 0 ? '+' : '') + formatCurrency(item.priceDiff) : '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Empty State */}
            {(!budgetA || !budgetB) && (
                <div className="text-center py-16 text-slate-400 bg-white rounded-xl border border-slate-200">
                    <GitCompare size={48} className="mx-auto mb-4 opacity-50" />
                    <p className="font-medium">Selecione dois orçamentos para comparar</p>
                </div>
            )}
        </div>
    );
};

export default BudgetComparison;
