import type { Budget, BudgetItem } from '../types/domain';
import { BudgetService } from '../lib/supabase-services/BudgetService';
import { BudgetItemService } from '../lib/supabase-services/BudgetItemService';
import React, { useState, useEffect } from 'react';
import {
    Clock,
    CheckCircle,
    AlertTriangle,
    DollarSign,
    ArrowRight,
    Plus,
    FileText,
    Database,
    Search,
    AlertOctagon,
    Briefcase
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';

// Card de Estatística Técnica
const TechnicalStatCard = ({ title, value, subtext, icon: Icon, color, onClick }: any) => (
    <div
        onClick={onClick}
        className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group"
    >
        <div className="flex justify-between items-start mb-4">
            <div className={`p-3 rounded-lg ${color} bg-opacity-10 group-hover:bg-opacity-20 transition-colors`}>
                <Icon size={24} className={color.replace('bg-', 'text-')} />
            </div>
            {subtext && <span className="text-xs font-mono text-slate-400 bg-slate-50 px-2 py-1 rounded">{subtext}</span>}
        </div>
        <div>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{title}</p>
            <h3 className="text-2xl font-bold text-slate-800 font-mono tracking-tight">{value}</h3>
        </div>
    </div>
);

// Resumo Técnico do Orçamento
const BudgetTechnicalSummary = ({ budget, items }: { budget: Budget, items: BudgetItem[] }) => {
    // Calcular totais por grupo (simplificado)
    // Assumindo que temos como distinguir Material, MO, Equipamento.
    // Se não tivermos categorização explícita fácil, vamos usar uma heurística ou dados mokados se necessário,
    // mas o ideal é usar item.type ou similar.
    // O schema atual tem item.type ('material', 'sinapi', etc)?
    // Vamos usar o que temos. O itemType pode ajudar.

    const total = items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    const bdiVal = total * ((budget.bdi || 0) / 100);
    const totalComBDI = total + bdiVal;

    // Tentativa de categorização (apenas exemplo, ajuste conforme seu modelo real de dados)
    let material = 0;
    let labor = 0;
    let equip = 0;

    items.forEach(item => {
        // Lógica simplificada: "MO" ou "H" no código/unidade pode indicar Mão de Obra
        const txt = (item.description || '').toLowerCase() + (item.unit || '').toLowerCase();
        if (txt.includes('h') || txt.includes('hora') || txt.includes('servente') || txt.includes('pedreiro')) {
            labor += item.totalPrice || 0;
        } else if (txt.includes('caminhão') || txt.includes('trator') || txt.includes('locação')) {
            equip += item.totalPrice || 0;
        } else {
            material += item.totalPrice || 0;
        }
    });

    const pMat = total > 0 ? (material / total) * 100 : 0;
    const pLabor = total > 0 ? (labor / total) * 100 : 0;
    const pEquip = total > 0 ? (equip / total) * 100 : 0;

    return (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Resumo Técnico Ativo</h3>
                    <p className="text-xs text-slate-500 mt-1">{budget.name}</p>
                </div>
                <div className="text-right">
                    <p className="text-xs text-slate-400">Total Global</p>
                    <p className="text-lg font-mono font-bold text-slate-800">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalComBDI)}
                    </p>
                </div>
            </div>

            <div className="space-y-4">
                <div className="space-y-2">
                    <div className="flex justify-between text-xs font-medium">
                        <span className="text-slate-600">Materiais</span>
                        <span className="font-mono">{pMat.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pMat}%` }}></div>
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between text-xs font-medium">
                        <span className="text-slate-600">Mão de Obra</span>
                        <span className="font-mono">{pLabor.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pLabor}%` }}></div>
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between text-xs font-medium">
                        <span className="text-slate-600">Equipamentos</span>
                        <span className="font-mono">{pEquip.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-purple-500 rounded-full" style={{ width: `${pEquip}%` }}></div>
                    </div>
                </div>

                <div className="pt-4 border-t border-slate-100 mt-4">
                    <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg">
                        <span className="text-xs font-bold text-slate-600">Incidência BDI</span>
                        <span className="text-sm font-mono font-bold text-slate-800">{budget.bdi}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Item de Alerta
const AlertItem = ({ type, count, label, onClick }: any) => (
    <div
        onClick={onClick}
        className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer group"
    >
        <div className="flex items-center gap-3">
            <div className={clsx(
                "p-2 rounded-lg",
                type === 'critical' ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
            )}>
                <AlertTriangle size={18} />
            </div>
            <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">{label}</span>
        </div>
        <div className="flex items-center gap-2">
            <span className={clsx(
                "text-xs font-bold px-2 py-1 rounded-full",
                count > 0 ? (type === 'critical' ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700") : "bg-slate-100 text-slate-400"
            )}>
                {count}
            </span>
            <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-500" />
        </div>
    </div>
);

const Dashboard = () => {
    const navigate = useNavigate();

    // States
    const [budgets, setBudgets] = useState<Budget[]>([]);
    const [allBudgets, setAllBudgets] = useState<Budget[]>([]);
    const [lastBudgetItems, setLastBudgetItems] = useState<BudgetItem[]>([]);
    const [alerts, setAlerts] = useState({ zeroPrice: 0, noComposition: 0, zeroBDI: 0 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchDashboardData = async () => {
            setLoading(true);
            try {
                // Fetch all budgets
                const fetchedAll = await BudgetService.getAll();
                setAllBudgets(fetchedAll);

                // Last 10 edited budgets
                const sorted = [...fetchedAll].sort((a, b) =>
                    new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
                );
                setBudgets(sorted.slice(0, 10));

                // Last budget items for technical summary
                const lastEdited = sorted[0];
                if (lastEdited?.id) {
                    const items = await BudgetItemService.getByBudgetId(lastEdited.id);
                    setLastBudgetItems(items);
                }

                // Calculate Alertas
                const activeBudgets = fetchedAll.filter(b => b.status === 'draft' || b.status === 'pending');
                const activeIds = activeBudgets.map(b => b.id!);

                let zeroPriceCount = 0;
                if (activeIds.length > 0) {
                    // For each active budget, check items
                    // Note: This could be optimized to fetch all items for all active budgets in one query
                    // but for a few budgets it's okay.
                    for (const budgetId of activeIds) {
                        const items = await BudgetItemService.getByBudgetId(budgetId);
                        zeroPriceCount += items.filter(i => i.totalPrice === 0).length;
                    }
                }

                const zeroBDICount = activeBudgets.filter(b => !b.bdi || b.bdi === 0).length;
                setAlerts({ zeroPrice: zeroPriceCount, noComposition: 0, zeroBDI: zeroBDICount });
            } catch (error) {
                console.error('Error fetching dashboard data:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchDashboardData();
    }, []);

    const activeBudgets = allBudgets.filter(b => b.status === 'draft' || b.status === 'pending');
    const finishedBudgets = allBudgets.filter(b => b.status === 'approved');

    // Valor total em estudo (apenas ativos)
    const totalValueInStudy = activeBudgets.reduce((acc, b) => {
        const val = b.totalValue || 0;
        const bdiVal = val * (1 + (b.bdi || 0) / 100);
        return acc + bdiVal;
    }, 0);

    // Último orçamento editado para o resumo técnico
    const lastEditedBudget = budgets.length > 0 ? budgets[0] : null;

    const formatMoney = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    return (
        <div className="space-y-8 animate-fade-in max-w-7xl mx-auto">
            {/* Header Técnico */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Briefcase className="text-indigo-600" size={28} />
                        Visão Geral do Projetista
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">
                        Acompanhamento de orçamentos, custos e pendências técnicas.
                    </p>
                </div>
                <div className="flex gap-3">
                    <span className="px-3 py-1 bg-slate-100 text-slate-500 text-xs font-mono rounded flex items-center gap-2">
                        <Clock size={12} />
                        {new Date().toLocaleDateString()}
                    </span>
                    <button
                        onClick={() => navigate('/budgets')}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm transition-all"
                    >
                        <Plus size={16} />
                        Novo Orçamento
                    </button>
                </div>
            </div>

            {/* KPIs Principais */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <TechnicalStatCard
                    title="Em Andamento"
                    value={activeBudgets.length}
                    subtext="Edição / Revisão"
                    icon={Clock}
                    color="bg-indigo-500 text-indigo-600"
                    onClick={() => navigate('/budgets')}
                />
                <TechnicalStatCard
                    title="Finalizados"
                    value={finishedBudgets.length}
                    subtext="Aprovados"
                    icon={CheckCircle}
                    color="bg-green-500 text-green-600"
                    onClick={() => navigate('/budgets?status=approved')}
                />
                <TechnicalStatCard
                    title="Volume em Estudo"
                    value={formatMoney(totalValueInStudy)}
                    subtext="Soma + BDI"
                    icon={DollarSign}
                    color="bg-slate-600 text-slate-700"
                    onClick={() => navigate('/budgets')}
                />
                <TechnicalStatCard
                    title="Alertas Técnicos"
                    value={(alerts?.zeroPrice || 0) + (alerts?.zeroBDI || 0)}
                    subtext="Pendências"
                    icon={AlertTriangle}
                    color="bg-amber-500 text-amber-600"
                    onClick={() => navigate('/budgets')}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Coluna Principal: Orçamentos Recentes */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                <FileText size={18} className="text-slate-400" />
                                Últimos Orçamentos Editados
                            </h3>
                            <button
                                onClick={() => navigate('/budgets')}
                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                            >
                                Ver todos <ArrowRight size={12} />
                            </button>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {budgets?.map(budget => (
                                <div key={budget.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between group">
                                    <div className="flex gap-4 items-center">
                                        <div className={clsx(
                                            "w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs",
                                            budget.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                                        )}>
                                            {budget.status === 'approved' ? 'OK' : 'ED'}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 text-sm group-hover:text-indigo-600 transition-colors">{budget.name}</h4>
                                            <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                                                <span>{budget.client || 'Cliente não informado'}</span>
                                                <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                                                <span>{format(new Date(budget.updatedAt || budget.createdAt || new Date()), "dd/MM 'às' HH:mm", { locale: ptBR })}</span>
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-mono font-bold text-slate-700 text-sm">
                                            {formatMoney((budget.totalValue || 0) * (1 + (budget.bdi || 0) / 100))}
                                        </p>
                                        <button
                                            onClick={() => navigate(`/budgets/${budget.id}`)}
                                            className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            CONTINUAR
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {(!budgets || budgets.length === 0) && (
                                <div className="p-8 text-center text-slate-400">
                                    <Database className="mx-auto mb-3 opacity-20" size={32} />
                                    <p className="text-sm">Nenhum orçamento encontrado.</p>
                                    <button
                                        onClick={() => navigate('/budgets')}
                                        className="text-indigo-600 text-xs font-bold mt-2"
                                    >
                                        Criar primeiro orçamento
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Bloco de Ações Rápidas */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <button
                            onClick={() => navigate('/insumos')}
                            className="bg-white p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all text-left group"
                        >
                            <div className="bg-indigo-50 w-8 h-8 rounded-lg flex items-center justify-center text-indigo-600 mb-3 group-hover:scale-110 transition-transform">
                                <Database size={16} />
                            </div>
                            <h4 className="font-bold text-slate-700 text-sm">Banco de Insumos</h4>
                            <p className="text-xs text-slate-400 mt-1">Gerenciar preços e itens</p>
                        </button>
                        <button
                            onClick={() => navigate('/proposals')}
                            className="bg-white p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all text-left group"
                        >
                            <div className="bg-purple-50 w-8 h-8 rounded-lg flex items-center justify-center text-purple-600 mb-3 group-hover:scale-110 transition-transform">
                                <FileText size={16} />
                            </div>
                            <h4 className="font-bold text-slate-700 text-sm">Propostas</h4>
                            <p className="text-xs text-slate-400 mt-1">Gerar e emitir docs</p>
                        </button>
                        <button
                            onClick={() => navigate('/clients')}
                            className="bg-white p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all text-left group"
                        >
                            <div className="bg-blue-50 w-8 h-8 rounded-lg flex items-center justify-center text-blue-600 mb-3 group-hover:scale-110 transition-transform">
                                <Briefcase size={16} />
                            </div>
                            <h4 className="font-bold text-slate-700 text-sm">Clientes</h4>
                            <p className="text-xs text-slate-400 mt-1">Gerenciar cadastro</p>
                        </button>
                        <button
                            onClick={() => navigate('/search')}
                            className="bg-white p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all text-left group"
                        >
                            <div className="bg-slate-50 w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 mb-3 group-hover:scale-110 transition-transform">
                                <Search size={16} />
                            </div>
                            <h4 className="font-bold text-slate-700 text-sm">Busca Global</h4>
                            <p className="text-xs text-slate-400 mt-1">Pesquisar em tudo</p>
                        </button>
                    </div>
                </div>

                {/* Coluna Lateral: Resumo e Alertas */}
                <div className="space-y-6">
                    {/* Resumo Técnico do Último Orçamento */}
                    {lastEditedBudget && lastBudgetItems && (
                        <BudgetTechnicalSummary budget={lastEditedBudget} items={lastBudgetItems} />
                    )}

                    {/* Painel de Alertas */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                        <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                            <AlertOctagon size={18} className="text-amber-500" />
                            Painel de Alertas
                        </h3>
                        <div className="space-y-3">
                            <AlertItem
                                type="critical"
                                count={alerts?.zeroPrice || 0}
                                label="Itens com preço zerado"
                                onClick={() => navigate('/budgets')}
                            />
                            <AlertItem
                                type="warning"
                                count={alerts?.zeroBDI || 0}
                                label="Orçamentos sem BDI"
                                onClick={() => navigate('/budgets')}
                            />
                            {/* Placeholder para funcionalidade futura real */}
                            <AlertItem
                                type="warning"
                                count={0}
                                label="Bases desatualizadas"
                                onClick={() => navigate('/budgets')}
                            />
                        </div>
                        <div className="mt-4 pt-4 border-t border-slate-100">
                            <p className="text-[10px] text-slate-400 leading-relaxed text-center">
                                * Monitore os alertas regularmente para garantir a consistência técnica dos seus orçamentos.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer Compliance */}
            <div className="text-center pt-8 pb-4">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                    Software para Uso Profissional de Engenharia
                </p>
            </div>
        </div>
    );
};

export default Dashboard;
