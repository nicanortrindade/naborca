import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AiImportItem } from '../features/importer/types';
import { Loader2, ArrowLeft, Check, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ImportReviewPageProps {
    jobId: string;
}

export default function ImportReviewPage({ jobId }: ImportReviewPageProps) {
    const navigate = useNavigate();
    const [items, setItems] = useState<AiImportItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        fetchItems();
    }, [jobId]);

    const fetchItems = async () => {
        try {
            setLoading(true);
            const { data, error } = await (supabase
                .from('import_items' as any) as any)
                .select('*')
                .eq('job_id', jobId)
                .order('created_at', { ascending: true });

            if (error) throw error;
            setItems(data);
        } catch (err: any) {
            console.error('Fetch error:', err);
            setError(err.message || 'Erro ao carregar itens.');
        } finally {
            setLoading(false);
        }
    };

    const handleConfirm = async () => {
        try {
            setConfirming(true);
            // Update job status to done
            const { error } = await (supabase
                .from('import_jobs' as any) as any)
                .update({ status: 'done' })
                .eq('id', jobId);

            if (error) throw error;

            // Redirect to budgets (encerrar fluxo)
            navigate('/budgets');
        } catch (err: any) {
            alert('Erro ao confirmar: ' + err.message);
            setConfirming(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen bg-slate-50">
                <Loader2 className="animate-spin text-blue-600" size={32} />
                <span className="ml-2 text-slate-600 font-medium">Carregando itens importados...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-slate-50 p-8 flex flex-col items-center justify-center text-red-600">
                <AlertCircle size={48} className="mb-4" />
                <p className="font-bold text-lg">Erro ao carregar itens</p>
                <p className="text-slate-600 mt-2">{error}</p>
                <button
                    onClick={() => navigate('/budgets')}
                    className="mt-6 px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 font-medium shadow-sm transition-colors"
                >
                    Voltar para Orçamentos
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8">
            <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Revisão da Importação</h1>
                        <p className="text-slate-500 text-sm mt-1">Job ID: <span className="font-mono bg-slate-100 px-1 rounded">{jobId}</span></p>
                    </div>
                    <div className="flex gap-3 w-full md:w-auto">
                        <button
                            onClick={() => navigate('/budgets')}
                            className="flex-1 md:flex-none px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors flex items-center justify-center gap-2"
                        >
                            <ArrowLeft size={18} />
                            Voltar
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={confirming}
                            className="flex-1 md:flex-none px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 transition-all hover:shadow-md"
                        >
                            {confirming ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                            Confirmar Importação
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    {items.length === 0 ? (
                        <div className="p-12 text-center text-slate-500 bg-slate-50/50">
                            <p className="text-lg">Nenhum item encontrado para esta importação.</p>
                            <p className="text-sm mt-2">O processamento pode não ter gerado resultados ou ocorreu um erro.</p>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider border-b border-slate-200">
                                    <th className="p-4 font-semibold">Descrição</th>
                                    <th className="p-4 font-semibold w-24 text-center">Qtd</th>
                                    <th className="p-4 font-semibold w-24 text-center">Unid</th>
                                    <th className="p-4 font-semibold w-32 text-right">Preço</th>
                                    <th className="p-4 font-semibold w-24 text-center">Confiança</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm">
                                {items.map((item) => (
                                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="p-4 text-slate-900 font-medium">
                                            {item.description_normalized || <span className="text-slate-400 italic">Sem descrição</span>}
                                        </td>
                                        <td className="p-4 text-slate-600 text-center">
                                            {item.quantity?.toLocaleString('pt-BR') || '-'}
                                        </td>
                                        <td className="p-4 text-slate-600 text-center">
                                            {item.unit || '-'}
                                        </td>
                                        <td className="p-4 text-right font-mono text-slate-700">
                                            {item.price_selected
                                                ? item.price_selected.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                                                : '-'}
                                        </td>
                                        <td className="p-4 text-center">
                                            {item.confidence_score !== null ? (
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold
                                                    ${(item.confidence_score || 0) > 0.8 ? 'bg-green-100 text-green-700' :
                                                        (item.confidence_score || 0) > 0.5 ? 'bg-amber-100 text-amber-700' :
                                                            'bg-red-100 text-red-700'
                                                    }
                                                `}>
                                                    {Math.round((item.confidence_score || 0) * 100)}%
                                                </span>
                                            ) : (
                                                <span className="text-slate-400 text-xs">-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
                {items.length > 0 && (
                    <div className="p-4 border-t border-slate-100 bg-slate-50 text-xs text-slate-500 text-center">
                        Exibindo {items.length} itens recuperados da Inteligência Artificial.
                    </div>
                )}
            </div>
        </div>
    );
}
