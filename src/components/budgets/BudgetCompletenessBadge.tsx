
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { AlertTriangle, CheckCircle, Loader2, Database, FileText } from 'lucide-react';

interface Stats {
    total: number;
    base: number;
    pdf: number;
    pending: number;
}

export const BudgetCompletenessBadge = ({ budgetId }: { budgetId: string }) => {
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchStats = async () => {
        try {
            // Fetch item stats
            const { data: items, error } = await supabase
                .from('budget_items')
                .select('hydration_status')
                .eq('budget_id', budgetId);

            if (error) throw error;

            // Fetch pending issues count
            const { count: pendingCount, error: pendingError } = await supabase
                .from('import_hydration_issues')
                .select('id', { count: 'exact', head: true })
                .eq('budget_id', budgetId)
                .eq('status', 'open');

            if (pendingError) throw pendingError;

            const total = items?.length || 0;
            const base = items?.filter(i => i.hydration_status === 'source_db').length || 0;
            const pdf = items?.filter(i => i.hydration_status === 'imported_text').length || 0;

            setStats({
                total,
                base,
                pdf,
                pending: pendingCount || 0
            });
        } catch (err) {
            console.error("Error fetching completeness stats:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();

        // Subscribe to changes
        const ch = supabase.channel(`stats-${budgetId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_items', filter: `budget_id=eq.${budgetId}` }, fetchStats)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'import_hydration_issues', filter: `budget_id=eq.${budgetId}` }, fetchStats)
            .subscribe();

        return () => { supabase.removeChannel(ch); };
    }, [budgetId]);

    if (loading) return <span className="bg-slate-100 text-slate-400 text-xs px-2 py-1 rounded animate-pulse">Carregando status...</span>;
    if (!stats) return null;

    return (
        <div className="flex items-center gap-3 bg-white border border-slate-200 shadow-sm px-3 py-1.5 rounded-lg text-xs font-medium">
            <div className="flex items-center gap-1.5 text-slate-600" title="Itens da Base (Hidratados)">
                <Database size={14} className="text-emerald-500" />
                <span>{stats.base} <span className="hidden sm:inline">Base</span></span>
            </div>
            <div className="w-px h-3 bg-slate-200"></div>
            <div className="flex items-center gap-1.5 text-slate-600" title="Itens do PDF (Texto)">
                <FileText size={14} className="text-blue-500" />
                <span>{stats.pdf} <span className="hidden sm:inline">PDF</span></span>
            </div>

            {stats.pending > 0 ? (
                <>
                    <div className="w-px h-3 bg-slate-200"></div>
                    <div className="flex items-center gap-1.5 text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded-md animate-pulse cursor-help" title="Itens Pendentes de Resolução">
                        <AlertTriangle size={14} />
                        <span>{stats.pending} pendentes</span>
                    </div>
                </>
            ) : (
                <>
                    <div className="w-px h-3 bg-slate-200"></div>
                    <div className="flex items-center gap-1.5 text-emerald-600 font-bold">
                        <CheckCircle size={14} />
                        <span className="hidden sm:inline">Completo</span>
                    </div>
                </>
            )}
        </div>
    );
};
