
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
// import { db, type ChangeLog } from '../sdk/database/orm/db'; // Removed Dexie
// import { useLiveQuery } from 'dexie-react-hooks'; // Removed Dexie
import { ChangeLogService } from '../lib/supabase-services/ChangeLogService';
import { BudgetService } from '../lib/supabase-services/BudgetService';
import { type ChangeLog, type Budget } from '../types/domain';
import { History, ArrowLeft, Plus, Edit3, Trash2, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const ChangeHistory: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    // const budgetId = Number(id); // Supabase uses UUID strings

    const [budget, setBudget] = useState<Budget | null>(null);
    const [logs, setLogs] = useState<ChangeLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            if (!id) return;
            setIsLoading(true);
            try {
                const [budgetData, logsData] = await Promise.all([
                    BudgetService.getById(id),
                    ChangeLogService.getByBudgetId(id)
                ]);
                setBudget(budgetData);
                setLogs(logsData);
            } catch (error) {
                console.error("Error loading change history:", error);
                // handle error, maybe redirect or show toast
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, [id]);


    const getActionIcon = (action: ChangeLog['action']) => {
        switch (action) {
            case 'create': return <Plus className="text-green-500" size={16} />;
            case 'update': return <Edit3 className="text-blue-500" size={16} />;
            case 'delete': return <Trash2 className="text-red-500" size={16} />;
            case 'status_change': return <Edit3 className="text-purple-500" size={16} />; // Added status_change handling just in case
            default: return <Edit3 className="text-slate-500" size={16} />;

        }
    };

    const getActionColor = (action: ChangeLog['action']) => {
        switch (action) {
            case 'create': return 'bg-green-50 border-green-200 text-green-800';
            case 'update': return 'bg-blue-50 border-blue-200 text-blue-800';
            case 'delete': return 'bg-red-50 border-red-200 text-red-800';
            case 'status_change': return 'bg-purple-50 border-purple-200 text-purple-800';
            default: return 'bg-slate-50 border-slate-200 text-slate-800';
        }
    };

    const formatDate = (date: Date) => {
        return format(new Date(date), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR });
    };

    if (isLoading) {
        return <div className="p-8 text-center text-slate-500">Carregando...</div>;
    }

    if (!budget) {
        return <div className="p-8 text-center text-red-500">Orçamento não encontrado.</div>;
    }

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <header className="mb-8">
                <button
                    onClick={() => navigate(`/budgets/${id}`)}
                    className="flex items-center gap-2 text-slate-500 hover:text-slate-800 mb-4"
                >
                    <ArrowLeft size={16} /> Voltar ao Orçamento
                </button>
                <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                    <History className="text-blue-600" />
                    Histórico de Alterações
                </h1>
                <p className="text-slate-500 mt-2">
                    {budget.name} - Todas as modificações feitas neste orçamento
                </p>
            </header>

            {logs && logs.length > 0 ? (
                <div className="space-y-4">
                    {logs.map((log) => (
                        <div
                            key={log.id}
                            className={`p-4 rounded-xl border ${getActionColor(log.action)} flex items-start gap-4`}
                        >
                            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm">
                                {getActionIcon(log.action)}
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-semibold">{log.description}</p>
                                        {log.field && (
                                            <p className="text-sm mt-1 opacity-80">
                                                Campo: <span className="font-mono">{log.field}</span>
                                            </p>
                                        )}
                                        {(log.oldValue || log.newValue) && (
                                            <div className="text-sm mt-2 flex gap-4">
                                                {log.oldValue && (
                                                    <span className="bg-white/50 px-2 py-1 rounded">
                                                        De: <span className="line-through">{log.oldValue}</span>
                                                    </span>
                                                )}
                                                {log.newValue && (
                                                    <span className="bg-white/50 px-2 py-1 rounded">
                                                        Para: <span className="font-medium">{log.newValue}</span>
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs opacity-70">
                                        <Clock size={12} />
                                        {formatDate(log.timestamp)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
                    <History size={48} className="mx-auto mb-4 text-slate-300" />
                    <p className="font-medium text-slate-500">Nenhuma alteração registrada ainda</p>
                    <p className="text-sm text-slate-400 mt-1">
                        As modificações feitas a partir de agora serão exibidas aqui
                    </p>
                </div>
            )}
        </div>
    );
};

export default ChangeHistory;
