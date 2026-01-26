
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { AlertTriangle, Check, X, Search, FileSpreadsheet, Layers, ArrowRight } from 'lucide-react';
import { InsumoService } from '../../lib/supabase-services/InsumoService';
import { CompositionService } from '../../lib/supabase-services/CompositionService';

interface Issue {
    id: string;
    item_id: string;
    item_code: string;
    item_description: string;
    suggestions: any; // jsonb
    created_at: string;
}

interface ImportPendencyPanelProps {
    budgetId: string;
    isOpen: boolean;
    onClose: () => void;
}

export const ImportPendencyPanel = ({ budgetId, isOpen, onClose }: ImportPendencyPanelProps) => {
    const [issues, setIssues] = useState<Issue[]>([]);
    const [loading, setLoading] = useState(true);
    const [resolvingId, setResolvingId] = useState<string | null>(null);

    const fetchIssues = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('import_hydration_issues')
                .select('*')
                .eq('budget_id', budgetId)
                .eq('status', 'open')
                .order('created_at', { ascending: true });

            if (error) throw error;
            setIssues(data || []);
        } catch (err) {
            console.error("Error fetching issues:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) fetchIssues();
    }, [isOpen, budgetId]);

    const handleResolve = async (issueId: string, action: 'use_base' | 'create_manual', payload: any) => {
        if (resolvingId) return;
        setResolvingId(issueId);

        try {
            const { error } = await supabase.rpc('resolve_import_hydration_issue', {
                issue_id: issueId,
                action_type: action,
                payload: payload
            });

            if (error) throw error;

            // Remove from list locally
            setIssues(prev => prev.filter(i => i.id !== issueId));

            // Trigger global refresh if needed (via window event or context)
            // window.dispatchEvent(new CustomEvent('budget-updated'));

        } catch (err: any) {
            console.error("Resolution failed:", err);
            alert(`Erro ao resolver pendência: ${err.message}`);
        } finally {
            setResolvingId(null);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-[60] border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="p-6 border-b border-slate-100 bg-amber-50 flex justify-between items-center">
                <div>
                    <h3 className="font-bold text-amber-900 flex items-center gap-2">
                        <AlertTriangle size={20} />
                        Pendências ({issues.length})
                    </h3>
                    <p className="text-xs text-amber-700 mt-1">Itens analíticos não encontrados na base.</p>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-amber-100 rounded-lg text-amber-800 transition-colors">
                    <X size={20} />
                </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                {loading ? (
                    <div className="flex justify-center p-8 text-slate-400">Carregando...</div>
                ) : issues.length === 0 ? (
                    <div className="text-center p-8 text-slate-500">
                        <Check size={48} className="mx-auto text-emerald-400 mb-4" />
                        <p className="font-medium">Tudo limpo!</p>
                        <p className="text-sm">Todas as pendências foram resolvidas.</p>
                    </div>
                ) : (
                    issues.map(issue => (
                        <div key={issue.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative group">
                            {resolvingId === issue.id && (
                                <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center">
                                    <span className="text-sm font-bold text-blue-600 animate-pulse">Resolvendo...</span>
                                </div>
                            )}

                            <div className="mb-3">
                                <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 mr-2">{issue.item_code}</span>
                                <p className="font-semibold text-slate-800 text-sm mt-1">{issue.item_description}</p>
                            </div>

                            {/* Suggestions */}
                            <div className="space-y-2">
                                {issue.suggestions?.best_match && (
                                    <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-lg">
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-[10px] text-emerald-600 font-bold uppercase flex items-center gap-1">
                                                <Search size={10} /> Sugestão da Base
                                            </span>
                                            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 rounded-full font-mono">
                                                {Math.round((issue.suggestions.score || 0) * 100)}% match
                                            </span>
                                        </div>
                                        <p className="text-xs font-medium text-emerald-900 mb-2 truncate" title={issue.suggestions.best_match.description}>
                                            {issue.suggestions.best_match.description}
                                        </p>
                                        <button
                                            onClick={() => handleResolve(issue.id, 'use_base', {
                                                selected_composition: {
                                                    id: issue.suggestions.best_match.id,
                                                    code: issue.suggestions.best_match.codigo
                                                }
                                            })}
                                            className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded shadow-sm transition-colors flex items-center justify-center gap-1"
                                        >
                                            Usar Base <ArrowRight size={12} />
                                        </button>
                                    </div>
                                )}

                                <div className="bg-slate-50 border border-slate-100 p-3 rounded-lg">
                                    <div className="mb-2">
                                        <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                                            <Layers size={10} /> Composição Própria
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-600 mb-2">
                                        Criar uma nova composição "Vazia/Manual" baseada no PDF.
                                    </p>
                                    <button
                                        onClick={() => handleResolve(issue.id, 'create_manual', {
                                            items: [] // In future this could come from AI extraction details if available
                                        })}
                                        className="w-full py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded shadow-sm transition-colors"
                                    >
                                        Criar Própria
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
