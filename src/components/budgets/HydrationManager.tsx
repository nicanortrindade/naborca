
import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { AlertTriangle, Search, Check, X, Wand2, Database, ChevronRight, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

interface HydrationIssue {
    id: string;
    budget_item_id: string;
    issue_type: string;
    original_code: string;
    original_description: string;
    status: 'open' | 'resolved';
}

interface HydrationManagerProps {
    budgetId: string;
    jobId: string;
    onClose: () => void;
    onResolved: () => void;
}

export default function HydrationManager({ budgetId, jobId, onClose, onResolved }: HydrationManagerProps) {
    const [issues, setIssues] = useState<HydrationIssue[]>([]);
    const [loading, setLoading] = useState(true);
    const [resolving, setResolving] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);

    // UI selection
    const [selectedIssue, setSelectedIssue] = useState<HydrationIssue | null>(null);

    useEffect(() => {
        fetchIssues();
    }, [jobId]);

    const fetchIssues = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('import_hydration_issues' as any)
                .select('*')
                .eq('job_id', jobId)
                .eq('status', 'open');
            if (error) throw error;
            setIssues(data || []);
            if (data?.length > 0 && !selectedIssue) setSelectedIssue(data[0]);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSearchSinapi = async () => {
        if (!searchQuery && !selectedIssue?.original_description) return;
        const q = searchQuery || selectedIssue?.original_description || '';

        try {
            setSearching(true);
            // Using a simple search logic on SINAPI (mocked here or using existing RPC if available)
            // For now, let's assume we search in a sinapi_table
            const { data, error } = await supabase
                .from('sinapi_table' as any) // Placeholder for actual search table
                .select('*')
                .or(`description.ilike.%${q}%,code.eq.${q}`)
                .limit(5);

            if (!error) setSearchResults(data || []);
        } catch (err) {
            console.error(err);
        } finally {
            setSearching(false);
        }
    };

    const resolveIssue = async (issueId: string, itemIId: string, selection: any) => {
        try {
            setResolving(issueId);
            const { data, error } = await supabase.rpc('resolve_import_hydration_issue', {
                p_issue_id: issueId,
                p_selected_composition: selection
            });

            if (error) throw error;

            // Success
            setIssues(prev => prev.filter(i => i.id !== issueId));
            if (selectedIssue?.id === issueId) setSelectedIssue(null);
            onResolved(); // Trigger budget reload
        } catch (err: any) {
            alert(`Erro ao resolver: ${err.message}`);
        } finally {
            setResolving(null);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[80vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-amber-500 text-white">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                            <AlertTriangle size={24} />
                        </div>
                        <div>
                            <h3 className="text-xl font-black">Gerenciador de Hidratação</h3>
                            <p className="text-amber-100 text-[10px] font-bold uppercase tracking-widest">{issues.length} pendências encontradas</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={24} /></button>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* List of Issues */}
                    <div className="w-1/3 border-r border-slate-100 overflow-y-auto bg-slate-50/30">
                        {loading ? (
                            <div className="p-8 text-center text-slate-400 font-bold animate-pulse uppercase text-xs">Carregando itens...</div>
                        ) : issues.length === 0 ? (
                            <div className="p-12 text-center">
                                <Check className="w-12 h-12 text-green-500 mx-auto mb-2" />
                                <p className="font-bold text-slate-700">Tudo pronto!</p>
                                <p className="text-xs text-slate-400">Nenhuma pendência pendente.</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {issues.map(issue => (
                                    <button
                                        key={issue.id}
                                        onClick={() => setSelectedIssue(issue)}
                                        className={clsx(
                                            "w-full text-left p-4 transition-all hover:bg-white flex items-center gap-3 group",
                                            selectedIssue?.id === issue.id ? "bg-white shadow-sm ring-1 ring-amber-200 z-10" : ""
                                        )}
                                    >
                                        <div className={clsx(
                                            "w-2 h-2 rounded-full shrink-0",
                                            selectedIssue?.id === issue.id ? "bg-amber-500" : "bg-slate-300"
                                        )}></div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Cód Original: {issue.original_code || '---'}</p>
                                            <p className="text-sm font-bold text-slate-700 truncate">{issue.original_description}</p>
                                        </div>
                                        <ChevronRight size={16} className="text-slate-300 group-hover:translate-x-1 transition-transform" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Resolution Workspace */}
                    <div className="flex-1 p-8 overflow-y-auto bg-white">
                        {selectedIssue ? (
                            <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-right-4">
                                <div className="space-y-4">
                                    <div className="inline-block px-3 py-1 bg-amber-100 text-amber-700 text-[10px] font-black rounded-lg uppercase">Resolução Pendente</div>
                                    <h2 className="text-2xl font-black text-slate-800 leading-tight">{selectedIssue.original_description}</h2>
                                    <div className="flex gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase">Código no PDF</p>
                                            <p className="font-mono font-bold text-slate-600">{selectedIssue.original_code || 'Não identificado'}</p>
                                        </div>
                                        <div className="border-l border-slate-200 pl-4">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase">Tipo de Erro</p>
                                            <p className="font-bold text-slate-600">Composição não encontrada</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Option 1: Search Sinapi */}
                                <div className="space-y-4">
                                    <h4 className="flex items-center gap-2 font-black text-slate-800 uppercase tracking-widest text-xs">
                                        <Database size={16} className="text-blue-600" /> Vincular à Base Oficial (Sinapi)
                                    </h4>
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-4 top-1/3 text-slate-400" size={18} />
                                            <input
                                                value={searchQuery}
                                                onChange={e => setSearchQuery(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleSearchSinapi()}
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-12 pr-4 font-bold text-slate-700 focus:ring-2 ring-blue-500 outline-none transition-all"
                                                placeholder="Buscar por descrição ou código..."
                                            />
                                        </div>
                                        <button onClick={handleSearchSinapi} className="px-6 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-colors">Buscar</button>
                                    </div>

                                    {/* Suggestion list */}
                                    <div className="space-y-2">
                                        {searching ? (
                                            <div className="py-4 text-center animate-pulse text-slate-400 text-xs font-bold uppercase">Pesquisando base...</div>
                                        ) : searchResults.map(item => (
                                            <div key={item.id} className="p-4 border border-slate-100 rounded-xl hover:border-blue-200 hover:bg-blue-50/40 flex items-center justify-between group transition-all">
                                                <div className="flex-1 pr-4">
                                                    <span className="text-[10px] font-mono text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded mr-2">{item.code}</span>
                                                    <span className="text-sm font-bold text-slate-700">{item.description}</span>
                                                    <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold">{item.unit} · R$ {item.unit_price?.toFixed(2)}</p>
                                                </div>
                                                <button
                                                    disabled={resolving !== null}
                                                    onClick={() => resolveIssue(selectedIssue.id, selectedIssue.budget_item_id, { source_type: 'internal_db', code: item.code })}
                                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-black hover:bg-blue-700 shadow-md shadow-blue-200 shrink-0 flex items-center gap-2"
                                                >
                                                    {resolving === selectedIssue.id ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
                                                    SELECIONAR
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Divider */}
                                <div className="h-px bg-slate-100"></div>

                                {/* Option 2: Manual */}
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="flex items-center gap-2 font-black text-slate-800 uppercase tracking-widest text-xs">
                                            <Wand2 size={16} className="text-purple-600" /> Manter como Próprio
                                        </h4>
                                        <button
                                            disabled={resolving !== null}
                                            onClick={() => resolveIssue(selectedIssue.id, selectedIssue.budget_item_id, { source_type: 'manual', items: [] })}
                                            className="text-xs font-bold text-slate-400 hover:text-slate-600 underline"
                                        >
                                            Manter valor cotado (sem analítico)
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-slate-300">
                                <Search size={64} className="mb-4 opacity-10" />
                                <p className="font-bold text-lg">Selecione um item à esquerda</p>
                                <p className="text-sm">Para iniciar a hidratação manual</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end">
                    <button onClick={onClose} className="px-8 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 shadow-sm transition-all focus:ring-2 ring-slate-200">
                        Fechar Painel
                    </button>
                </div>
            </div>
        </div>
    );
}
