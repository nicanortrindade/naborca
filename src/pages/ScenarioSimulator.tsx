import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BudgetService } from '../lib/supabase-services/BudgetService';
import { BudgetItemService } from '../lib/supabase-services/BudgetItemService';
import {
    createScenario,
    freezeBudget,
    listScenarios,
    type ScenarioConfig,
    type ScenarioResult
} from '../sdk/validation/ScenarioSimulator';
import {
    ChevronLeft,
    Plus,
    TrendingUp,
    TrendingDown,
    Lock,
    Unlock,
    Copy,
    Trash2,
    BarChart3,
    Percent,
    DollarSign,
    Users,
    Package,
    Wrench
} from 'lucide-react';
import ComplianceAlert from '../components/ComplianceAlert';
import { type Budget } from '../types/domain';

const ScenarioSimulatorPage = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const budgetId = id!;

    const [budget, setBudget] = useState<Budget | null>(null);
    const [scenarios, setScenarios] = useState<Budget[]>([]);
    const [showNewScenario, setShowNewScenario] = useState(false);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [result, setResult] = useState<ScenarioResult | null>(null);

    const [config, setConfig] = useState<ScenarioConfig>({
        name: '',
        bdiAdjustment: 0,
        laborAdjustment: 0,
        materialAdjustment: 0,
        equipmentAdjustment: 0,
        globalAdjustment: 0
    });

    const loadData = async () => {
        setLoading(true);
        try {
            const [budgetData, scenariosData] = await Promise.all([
                BudgetService.getById(budgetId),
                listScenarios(budgetId)
            ]);
            setBudget(budgetData);
            setScenarios(scenariosData);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [budgetId]);

    const handleCreateScenario = async () => {
        if (!config.name.trim()) {
            alert('Informe um nome para o cenário');
            return;
        }

        setCreating(true);
        try {
            const scenarioResult = await createScenario(budgetId, config);
            setResult(scenarioResult);
            setShowNewScenario(false);
            setConfig({
                name: '',
                bdiAdjustment: 0,
                laborAdjustment: 0,
                materialAdjustment: 0,
                equipmentAdjustment: 0,
                globalAdjustment: 0
            });
            await loadData();
        } catch (err: any) {
            alert(err.message || 'Erro ao criar cenário');
        } finally {
            setCreating(false);
        }
    };

    const handleFreeze = async () => {
        if (!window.confirm('Deseja congelar este orçamento? Após congelado, não será possível editar diretamente.')) {
            return;
        }

        try {
            await freezeBudget(budgetId);
            alert('Orçamento congelado com sucesso!');
            await loadData();
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleDeleteScenario = async (scenarioId: string) => {
        if (!window.confirm('Excluir este cenário?')) return;

        try {
            const items = await BudgetItemService.getByBudgetId(scenarioId);
            for (const item of items) {
                await BudgetItemService.delete(item.id!);
            }
            await BudgetService.delete(scenarioId);
            await loadData();
        } catch (e) {
            console.error(e);
        }
    };

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    const formatPercent = (val: number) =>
        `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;

    if (loading) {
        return (
            <div className="p-8 text-center text-slate-500">Carregando...</div>
        );
    }

    if (!budget) {
        return (
            <div className="p-8 text-center">
                <p className="text-red-500">Orçamento não encontrado.</p>
                <button
                    onClick={() => navigate('/budgets')}
                    className="mt-4 text-indigo-600 font-medium text-sm hover:underline"
                >
                    ← Voltar para Lista de Orçamentos
                </button>
            </div>
        );
    }

    const originalTotal = budget.totalValue * (1 + (budget.bdi || 0) / 100);

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <button
                        onClick={() => navigate(`/budgets/${budgetId}`)}
                        className="flex items-center gap-2 text-slate-500 hover:text-slate-800 mb-2 transition-colors text-sm"
                    >
                        <ChevronLeft size={16} /> Voltar ao Orçamento
                    </button>
                    <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                        <BarChart3 className="text-indigo-600" />
                        Simulação de Cenários
                    </h1>
                    <p className="text-slate-500 mt-1">{budget.name}</p>
                </div>

                <div className="flex gap-3">
                    {!budget.isFrozen && (
                        <button
                            onClick={handleFreeze}
                            className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-600 transition-all"
                        >
                            <Lock size={16} />
                            Congelar Orçamento
                        </button>
                    )}
                    <button
                        onClick={() => setShowNewScenario(true)}
                        className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg"
                    >
                        <Plus size={18} />
                        Novo Cenário
                    </button>
                </div>
            </div>

            {/* Compliance Alert */}
            <ComplianceAlert
                type="info"
                title="Simulação de Cenários"
                message="Os cenários criados são simulações para análise de impacto financeiro. Não constituem orçamentos oficiais e são apenas para fins de planejamento interno."
                compact
            />

            {/* Status do Orçamento */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-slate-800">Orçamento Base</h2>
                    {budget.isFrozen ? (
                        <span className="flex items-center gap-2 bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-bold">
                            <Lock size={14} /> Congelado
                        </span>
                    ) : (
                        <span className="flex items-center gap-2 bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-bold">
                            <Unlock size={14} /> Editável
                        </span>
                    )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-4 bg-slate-50 rounded-xl">
                        <p className="text-xs text-slate-500 uppercase font-bold mb-1">Valor Base</p>
                        <p className="text-xl font-black text-slate-800">{formatCurrency(budget.totalValue)}</p>
                    </div>
                    <div className="text-center p-4 bg-slate-50 rounded-xl">
                        <p className="text-xs text-slate-500 uppercase font-bold mb-1">BDI</p>
                        <p className="text-xl font-black text-slate-800">{budget.bdi || 0}%</p>
                    </div>
                    <div className="text-center p-4 bg-indigo-50 rounded-xl">
                        <p className="text-xs text-indigo-600 uppercase font-bold mb-1">Total c/ BDI</p>
                        <p className="text-xl font-black text-indigo-700">{formatCurrency(originalTotal)}</p>
                    </div>
                    <div className="text-center p-4 bg-slate-50 rounded-xl">
                        <p className="text-xs text-slate-500 uppercase font-bold mb-1">Versão</p>
                        <p className="text-xl font-black text-slate-800">{budget.version || 'v1.0'}</p>
                    </div>
                </div>
            </div>

            {/* Lista de Cenários */}
            {scenarios && scenarios.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h2 className="text-lg font-bold text-slate-800 mb-4">Cenários Criados</h2>

                    <div className="space-y-3">
                        {scenarios.map(scenario => {
                            const scenarioTotal = scenario.totalValue * (1 + (scenario.bdi || 0) / 100);
                            const diff = scenarioTotal - originalTotal;
                            const percentDiff = (diff / originalTotal) * 100;
                            const isPositive = diff >= 0;

                            return (
                                <div
                                    key={scenario.id}
                                    className="flex items-center justify-between p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                                >
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded">
                                                CENÁRIO
                                            </span>
                                            <span className="font-bold text-slate-800">{scenario.scenarioName || scenario.name}</span>
                                        </div>
                                        <p className="text-sm text-slate-500">
                                            BDI: {scenario.bdi}% | Total: {formatCurrency(scenarioTotal)}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <div className={`text-right ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
                                            <div className="flex items-center gap-1 font-bold">
                                                {isPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                                                {formatCurrency(Math.abs(diff))}
                                            </div>
                                            <p className="text-xs">{formatPercent(percentDiff)}</p>
                                        </div>

                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => navigate(`/budgets/${scenario.id}`)}
                                                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                                title="Abrir"
                                            >
                                                <Copy size={16} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteScenario(scenario.id!)}
                                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                                title="Excluir"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Último Resultado */}
            {result && (
                <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-6 text-white">
                    <h3 className="font-bold text-lg mb-4">Cenário Criado: {result.scenarioName}</h3>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-center">
                            <p className="text-indigo-200 text-sm">Original</p>
                            <p className="text-2xl font-black">{formatCurrency(result.originalTotal)}</p>
                        </div>
                        <div className="text-center">
                            <p className="text-indigo-200 text-sm">Cenário</p>
                            <p className="text-2xl font-black">{formatCurrency(result.adjustedTotal)}</p>
                        </div>
                        <div className="text-center">
                            <p className="text-indigo-200 text-sm">Variação</p>
                            <p className="text-2xl font-black">{formatPercent(result.percentChange)}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Novo Cenário */}
            {showNewScenario && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl">
                        <div className="p-6 border-b border-slate-100">
                            <h2 className="text-xl font-bold text-slate-800">Criar Novo Cenário</h2>
                            <p className="text-slate-500 text-sm mt-1">
                                Configure os ajustes percentuais para simular o impacto
                            </p>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                    Nome do Cenário *
                                </label>
                                <input
                                    type="text"
                                    value={config.name}
                                    onChange={e => setConfig({ ...config, name: e.target.value })}
                                    className="w-full p-3 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none"
                                    placeholder="Ex: BDI +5%, Reajuste MO 10%"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase mb-2">
                                        <Percent size={12} /> Ajuste BDI (p.p.)
                                    </label>
                                    <input
                                        type="number"
                                        value={config.bdiAdjustment}
                                        onChange={e => setConfig({ ...config, bdiAdjustment: Number(e.target.value) })}
                                        className="w-full p-3 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none"
                                        placeholder="0"
                                    />
                                </div>
                                <div>
                                    <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase mb-2">
                                        <DollarSign size={12} /> Ajuste Global (%)
                                    </label>
                                    <input
                                        type="number"
                                        value={config.globalAdjustment}
                                        onChange={e => setConfig({ ...config, globalAdjustment: Number(e.target.value) })}
                                        className="w-full p-3 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none"
                                        placeholder="0"
                                    />
                                </div>
                            </div>

                            <div className="border-t border-slate-100 pt-4">
                                <p className="text-xs font-bold text-slate-400 uppercase mb-3">Ajustes por Tipo de Insumo</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="flex items-center gap-2 text-xs font-bold text-slate-500 mb-2">
                                            <Users size={12} /> Mão de Obra (%)
                                        </label>
                                        <input
                                            type="number"
                                            value={config.laborAdjustment}
                                            onChange={e => setConfig({ ...config, laborAdjustment: Number(e.target.value) })}
                                            className="w-full p-3 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none"
                                            placeholder="0"
                                        />
                                    </div>
                                    <div>
                                        <label className="flex items-center gap-2 text-xs font-bold text-slate-500 mb-2">
                                            <Package size={12} /> Materiais (%)
                                        </label>
                                        <input
                                            type="number"
                                            value={config.materialAdjustment}
                                            onChange={e => setConfig({ ...config, materialAdjustment: Number(e.target.value) })}
                                            className="w-full p-3 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none"
                                            placeholder="0"
                                        />
                                    </div>
                                    <div>
                                        <label className="flex items-center gap-2 text-xs font-bold text-slate-500 mb-2">
                                            <Wrench size={12} /> Equipamentos (%)
                                        </label>
                                        <input
                                            type="number"
                                            value={config.equipmentAdjustment}
                                            onChange={e => setConfig({ ...config, equipmentAdjustment: Number(e.target.value) })}
                                            className="w-full p-3 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none"
                                            placeholder="0"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50 border-t flex justify-end gap-3 rounded-b-2xl">
                            <button
                                onClick={() => setShowNewScenario(false)}
                                className="px-6 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-xl transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleCreateScenario}
                                disabled={loading}
                                className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-50"
                            >
                                {loading ? 'Criando...' : 'Criar Cenário'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ScenarioSimulatorPage;
