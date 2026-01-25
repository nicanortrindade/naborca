import { useState, useEffect } from 'react';
import { BudgetService } from '../lib/supabase-services/BudgetService';
import { BudgetItemService } from '../lib/supabase-services/BudgetItemService';
import { repairHierarchy, calculateBudget } from '../utils/calculationEngine';
import { useAuth } from '../context/AuthContext';
import { Plus, Trash2, Edit, Upload, Copy, Bookmark, Loader2, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BudgetImporter from '../components/budgets/BudgetImporter';
import AiImporterModal from '../components/budgets/AiImporterModal';
import { FEATURES } from '../config/features';

/**
 * Componente para exibir o Status em PT-BR com cores
 */
const StatusBadge = ({ status }: { status: string }) => {
    const statusMap: Record<string, { label: string, color: string }> = {
        'draft': { label: 'Rascunho', color: 'bg-slate-100 text-slate-600' },
        'pending': { label: 'Pendente', color: 'bg-amber-100 text-amber-600' },
        'approved': { label: 'Aprovado', color: 'bg-emerald-100 text-emerald-600' },
        'published': { label: 'Publicado', color: 'bg-blue-100 text-blue-600' },
        'archived': { label: 'Arquivado', color: 'bg-gray-100 text-gray-500' }
    };

    const config = statusMap[status?.toLowerCase()] || statusMap['draft'];

    return (
        <span className={`${config.color} px-2 py-1 rounded text-xs uppercase font-bold tracking-wide`}>
            {config.label}
        </span>
    );
};

/**
 * Componente para renderizar uma linha de orçamento com cálculo de total global
 */
const BudgetRow = ({ budget, onDuplicate, onSaveTemplate, onDelete, onClick }: any) => {
    const [totalGlobal, setTotalGlobal] = useState<number | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);

    useEffect(() => {
        let isMounted = true;

        const calculateTotal = async () => {
            if (!budget.id) return;

            // Se já tiver um valor total_value no banco e for coerente, poderíamos usar como fallback,
            // mas o requisito pede o "Total Global Real" re-calculado.
            try {
                setIsCalculating(true);
                // 1. Fetch itens raw do orçamento
                const items = await BudgetItemService.getByBudgetId(budget.id);

                if (isMounted) {
                    // 2. Rodar o Engine de Cálculo
                    const repair = repairHierarchy(items);
                    const result = calculateBudget(repair, budget.bdi ?? 0);

                    setTotalGlobal(result.totalGlobalFinal);
                }
            } catch (err) {
                console.error(`Erro ao calcular total do orçamento ${budget.id}:`, err);
                if (isMounted) setTotalGlobal(0);
            } finally {
                if (isMounted) setIsCalculating(false);
            }
        };

        calculateTotal();

        return () => { isMounted = false; };
    }, [budget.id, budget.bdi]);

    return (
        <tr
            className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer"
            onClick={onClick}
        >
            <td className="p-4 font-medium text-slate-900">{budget.name || 'Sem nome'}</td>
            <td className="p-4 text-slate-600">{budget.client || 'Sem cliente'}</td>
            <td className="p-4">
                <StatusBadge status={budget.status} />
            </td>
            <td className="p-4 text-slate-600">
                {budget.createdAt instanceof Date && !isNaN(budget.createdAt.getTime())
                    ? budget.createdAt.toLocaleDateString('pt-BR')
                    : '—'}
            </td>
            <td className="p-4 font-bold text-slate-700">
                {isCalculating ? (
                    <span className="text-[10px] text-slate-400 font-normal animate-pulse">Calculando...</span>
                ) : totalGlobal !== null ? (
                    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalGlobal)
                ) : (
                    '—'
                )}
            </td>
            <td className="p-4 text-right flex items-center justify-end gap-1">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDuplicate(budget);
                    }}
                    className="text-slate-400 hover:text-green-500 p-1.5"
                    title="Duplicar orçamento"
                >
                    <Copy size={16} />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onSaveTemplate(budget.id);
                    }}
                    className="text-slate-400 hover:text-purple-500 p-1.5"
                    title="Salvar como modelo"
                >
                    <Bookmark size={16} />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        if (budget.id) onClick();
                    }}
                    className="text-slate-400 hover:text-accent p-1.5"
                    title="Editar"
                >
                    <Edit size={16} />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        if (budget.id) onDelete(budget.id);
                    }}
                    className="text-slate-400 hover:text-red-500 p-1.5"
                    title="Excluir"
                >
                    <Trash2 size={16} />
                </button>
            </td>
        </tr>
    );
};

const Budgets = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [budgets, setBudgets] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [showImporter, setShowImporter] = useState(false);
    const [showAiImporter, setShowAiImporter] = useState(false);
    const [newBudgetName, setNewBudgetName] = useState('');

    useEffect(() => {
        loadBudgets();
    }, [user]);

    const loadBudgets = async () => {
        if (!user) return;
        try {
            setIsLoading(true);
            const data = await BudgetService.getAll();
            setBudgets(data || []);
        } catch (error) {
            console.error("Erro ao buscar orçamentos:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateBudget = async () => {
        if (!newBudgetName.trim() || !user) return;
        try {
            const newBudget = await BudgetService.create({
                name: newBudgetName,
                client: 'Sem cliente',
                date: new Date(),
                status: 'draft',
                totalValue: 0,
                bdi: 0,
            });
            setNewBudgetName('');
            setIsCreating(false);
            if (newBudget) navigate(`/budgets/${newBudget.id}`);
        } catch (error) {
            console.error("Failed to create budget", error);
            alert("Erro ao criar orçamento. Verifique o console para mais detalhes.");
        }
    };

    const handleDeleteBudget = async (id: string) => {
        if (window.confirm('Tem certeza que deseja excluir este orçamento?')) {
            try {
                await BudgetService.delete(id);
                loadBudgets();
            } catch (error) {
                console.error("Erro ao excluir orçamento:", error);
            }
        }
    };

    const handleDuplicateBudget = async (_budget: any) => {
        alert("Funcionalidade de duplicação em manutenção durante a migração.");
    };

    const handleSaveAsTemplate = async (_budgetId: string) => {
        alert("Funcionalidade de template em manutenção.");
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-slate-800">Meus Orçamentos</h2>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowImporter(true)}
                        className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
                    >
                        <Upload size={20} />
                        Importar Planilha
                    </button>
                    {FEATURES.aiImport && (
                        <button
                            onClick={() => setShowAiImporter(true)}
                            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-all shadow-md hover:shadow-lg border border-transparent"
                        >
                            <Sparkles size={18} className="text-yellow-300" />
                            Importar com IA
                            <span className="bg-white/20 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">BETA</span>
                        </button>
                    )}
                    <button
                        onClick={() => setIsCreating(true)}
                        className="bg-accent hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-md"
                    >
                        <Plus size={20} />
                        Novo Orçamento
                    </button>
                </div>
            </div>

            {isCreating && (
                <div className="bg-white p-4 rounded-lg shadow border border-slate-200 flex gap-2 items-center animate-fade-in">
                    <input
                        type="text"
                        placeholder="Nome do orçamento..."
                        className="flex-1 border p-2 rounded outline-none focus:border-accent"
                        value={newBudgetName}
                        onChange={(e) => setNewBudgetName(e.target.value)}
                        autoFocus
                    />
                    <button onClick={handleCreateBudget} className="bg-green-600 text-white px-4 py-2 rounded">Criar</button>
                    <button onClick={() => setIsCreating(false)} className="bg-slate-200 text-slate-700 px-4 py-2 rounded">Cancelar</button>
                </div>
            )}

            {showImporter && (
                <BudgetImporter
                    onClose={() => setShowImporter(false)}
                    onSuccess={(id: any) => navigate(`/budgets/${id}`)}
                />
            )}

            {showAiImporter && (
                <AiImporterModal
                    onClose={() => setShowAiImporter(false)}
                />
            )}

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                {isLoading ? (
                    <div className="p-12 flex justify-center text-slate-400">
                        <Loader2 className="animate-spin" />
                    </div>
                ) : (
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="p-4 font-semibold text-slate-600">Nome</th>
                                <th className="p-4 font-semibold text-slate-600">Cliente</th>
                                <th className="p-4 font-semibold text-slate-600">Status</th>
                                <th className="p-4 font-semibold text-slate-600">Criado em</th>
                                <th className="p-4 font-semibold text-slate-600">Total</th>
                                <th className="p-4 font-semibold text-slate-600 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {budgets?.map((budget, idx) => (
                                <BudgetRow
                                    key={budget.id || `temp-${idx}`}
                                    budget={budget}
                                    onClick={() => budget.id && navigate(`/budgets/${budget.id}`)}
                                    onDelete={handleDeleteBudget}
                                    onDuplicate={handleDuplicateBudget}
                                    onSaveTemplate={handleSaveAsTemplate}
                                />
                            ))}
                            {budgets?.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="p-12 text-center text-slate-400">
                                        Nenhum orçamento encontrado. Crie o primeiro acima!
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default Budgets;
