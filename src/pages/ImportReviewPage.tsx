
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AiImportItem } from '../features/importer/types';
import { Loader2, ArrowLeft, CheckCircle, AlertCircle, Wand2, FileSpreadsheet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toRelativePath } from '../utils/appUrl';

interface ImportReviewPageProps {
    jobId: string;
}

export default function ImportReviewPage({ jobId }: ImportReviewPageProps) {
    const navigate = useNavigate();
    const [items, setItems] = useState<any[]>([]); // Use loose type to match raw DB for now
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);
    const [jobContext, setJobContext] = useState<any>(null);

    const [params, setParams] = useState({
        uf: 'BA',
        competence: '2025-01',
        bdi_percent: 0,
        encargo_mode: 'nao_desonerado',
        encargo_horista_percent: 0,
        encargo_mensalista_percent: 0
    });

    useEffect(() => {
        fetchItems();
        fetchJobContext();
    }, [jobId]);

    const fetchJobContext = async () => {
        const { data } = await supabase.from('import_jobs' as any).select('document_context').eq('id', jobId).single();
        if (data && data.document_context) {
            setJobContext(data.document_context);
        }
    };

    const fetchItems = async () => {
        try {
            setLoading(true);
            // Fetch from import_ai_items (Phase 2 output)
            const { data, error } = await (supabase
                .from('import_ai_items' as any) as any)
                .select('*')
                .eq('job_id', jobId)
                .order('idx', { ascending: true }); // Use idx from extraction

            if (error) throw error;
            setItems(data || []);
        } catch (err: any) {
            console.error('Fetch error:', err);
            setError(err.message || 'Erro ao carregar itens.');
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateBudget = async () => {
        if (!jobId) return;
        setGenerating(true);

        try {
            const { data, error } = await supabase.functions.invoke('import-finalize-budget', {
                body: {
                    job_id: jobId, // Backend expects job_id
                    import_job_id: jobId, // Included for compliance with user instructions
                    uf: params.uf,
                    competence: params.competence,
                    desonerado: params.encargo_mode === 'desonerado',
                    bdi_mode: params.bdi_percent,
                    social_charges: {
                        horista: params.encargo_horista_percent,
                        mensalista: params.encargo_mensalista_percent
                    }
                }
            });

            if (error) {
                // Supabase Functions invoke returns an error object if the function fails or returns non-2xx
                // We convert it to a throwable error to be caught below
                throw new Error(error.message || "Erro na chamada da função");
            }

            const result = data;

            if (!result || !result.budget_id) {
                // Logical Error
                if (result?.reason === 'no_items_found') {
                    alert("Atenção: Nenhum item foi encontrado para gerar o orçamento.");
                    return;
                }
                if (result?.ok === false) {
                    throw new Error(result.details || result.reason || "Erro desconhecido no processamento.");
                }
                // Fallback
                throw new Error("Resposta inválida do servidor (Budget ID ausente).");
            }

            // Success
            navigate(toRelativePath(`/budget/${result.budget_id}`));

        } catch (err: any) {
            console.error("Generate Error:", err);
            alert(`Falha ao gerar orçamento: ${err.message}`);
        } finally {
            setGenerating(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center h-screen bg-slate-50 gap-3">
                <Loader2 className="animate-spin text-blue-600" size={32} />
                <span className="text-slate-600 font-medium animate-pulse">Carregando dados da IA...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-slate-50 p-8 flex flex-col items-center justify-center text-red-600">
                <div className="bg-white p-8 rounded-xl shadow-lg border border-red-100 flex flex-col items-center max-w-md w-full">
                    <AlertCircle size={48} className="mb-4 text-red-500" />
                    <p className="font-bold text-lg text-slate-800">Não foi possível carregar</p>
                    <p className="text-slate-600 mt-2 text-center text-sm">{error}</p>
                    <button
                        onClick={() => navigate('/budgets')}
                        className="mt-6 w-full px-4 py-3 bg-slate-800 text-white rounded-lg hover:bg-slate-900 font-medium transition-colors"
                    >
                        Voltar para Lista
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 p-4 md:p-8">
            <div className="max-w-7xl mx-auto space-y-6">

                {/* Header */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-4">
                        <div className="bg-blue-50 p-3 rounded-xl">
                            <Wand2 className="text-blue-600" size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Revisão da Importação (Fase 3)</h1>
                            <p className="text-slate-500 text-sm mt-0.5 flex items-center gap-2">
                                Job: <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs text-slate-700">{jobId.slice(0, 8)}...</span>
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3 w-full md:w-auto">

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mt-6">
                        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                            <FileSpreadsheet size={20} className="text-blue-600" /> Parâmetros do Orçamento
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Estado (UF)</label>
                                <select
                                    className="w-full p-2 border rounded-lg bg-slate-50 font-medium"
                                    value={params.uf}
                                    onChange={e => setParams({ ...params, uf: e.target.value })}
                                >
                                    <option value="BA">Bahia (BA)</option>
                                    <option value="SP">São Paulo (SP)</option>
                                    <option value="RJ">Rio de Janeiro (RJ)</option>
                                    <option value="MG">Minas Gerais (MG)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Competência</label>
                                <input
                                    type="month"
                                    className="w-full p-2 border rounded-lg bg-slate-50 font-medium"
                                    value={params.competence}
                                    onChange={e => setParams({ ...params, competence: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">BDI (%)</label>
                                <input
                                    type="number"
                                    className="w-full p-2 border rounded-lg bg-slate-50 font-medium"
                                    value={params.bdi_percent}
                                    onChange={e => setParams({ ...params, bdi_percent: parseFloat(e.target.value) })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Encargos (Horista %)</label>
                                <input
                                    type="number"
                                    className="w-full p-2 border rounded-lg bg-slate-50 font-medium"
                                    value={params.encargo_horista_percent}
                                    onChange={e => setParams({ ...params, encargo_horista_percent: parseFloat(e.target.value) })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Encargos (Mensalista %)</label>
                                <input
                                    type="number"
                                    className="w-full p-2 border rounded-lg bg-slate-50 font-medium"
                                    value={params.encargo_mensalista_percent}
                                    onChange={e => setParams({ ...params, encargo_mensalista_percent: parseFloat(e.target.value) })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Regime</label>
                                <div className="flex gap-2 bg-slate-50 p-1.5 rounded-lg border">
                                    <button
                                        className={`flex-1 text-xs font-bold py-1 rounded ${params.encargo_mode === 'nao_desonerado' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}
                                        onClick={() => setParams({ ...params, encargo_mode: 'nao_desonerado' })}
                                    >
                                        Não Des.
                                    </button>
                                    <button
                                        className={`flex-1 text-xs font-bold py-1 rounded ${params.encargo_mode === 'desonerado' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}
                                        onClick={() => setParams({ ...params, encargo_mode: 'desonerado' })}
                                    >
                                        Desonerado
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-3 justify-end mt-6">
                        <button
                            onClick={() => navigate('/budgets')}
                            className="px-5 py-2.5 border border-slate-200 text-slate-600 bg-white rounded-xl hover:bg-slate-50 hover:border-slate-300 font-medium transition-all flex items-center justify-center gap-2"
                        >
                            <ArrowLeft size={18} />
                            Cancelar
                        </button>
                        <button
                            onClick={handleGenerateBudget}
                            disabled={generating || items.length === 0}
                            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 active:transform active:scale-95 font-semibold shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2 transition-all min-w-[200px]"
                        >
                            {generating ? (
                                <>
                                    <Loader2 className="animate-spin" size={20} />
                                    Gerando Orçamento...
                                </>
                            ) : (
                                <>
                                    <FileSpreadsheet size={20} />
                                    Gerar Orçamento Final
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* FALLBACK WARNING (Phase 3.1) */}
            {jobContext?.structure_source === 'analytic_fallback' && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 w-full animate-in fade-in slide-in-from-top-2">
                    <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={20} />
                    <div>
                        <h4 className="font-bold text-amber-800 text-sm">Atenção: Fonte de Estrutura Alternativa</h4>
                        <p className="text-amber-700 text-sm mt-1">
                            O arquivo <strong>Sintético</strong> não continha texto legível (PDF escaneado?).
                            A estrutura do orçamento foi gerada a partir do arquivo <strong>Analítico</strong> para evitar bloqueio.
                            Recomendamos verificar se a hierarquia de itens está correta.
                        </p>
                    </div>
                </div>
            )}

            {/* Content */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-[400px]">
                {items.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-400 gap-4">
                        <div className="bg-slate-50 p-6 rounded-full">
                            <FileSpreadsheet size={48} className="opacity-20" />
                        </div>
                        <p className="text-lg font-medium text-slate-600">Nenhum item processado</p>
                        <p className="text-sm max-w-xs text-center">A extração via IA não retornou itens. Verifique se o arquivo original contém tabelas legíveis.</p>
                    </div>
                ) : (
                    <>
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                            <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide">Itens Extraídos ({items.length})</h3>
                            <div className="text-xs text-slate-400">Estes itens serão convertidos em orçamento</div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-white text-slate-500 text-xs font-semibold uppercase tracking-wider border-b border-slate-100">
                                        <th className="px-6 py-4 w-16 text-center">#</th>
                                        <th className="px-6 py-4">Descrição</th>
                                        <th className="px-6 py-4 w-24 text-center">Unid</th>
                                        <th className="px-6 py-4 w-32 text-right">Qtd</th>
                                        <th className="px-6 py-4 w-32 text-right">Preço Unit.</th>
                                        <th className="px-6 py-4 w-32 text-right">Total</th>
                                        <th className="px-6 py-4 w-28 text-center">Confiança</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {items.map((item, idx) => (
                                        <tr key={item.id || idx} className="hover:bg-slate-50/80 transition-colors group">
                                            <td className="px-6 py-3 text-center text-slate-400 text-xs font-mono">{idx + 1}</td>
                                            <td className="px-6 py-3 text-slate-800 font-medium text-sm group-hover:text-blue-700 transition-colors">
                                                {item.description || <span className="text-slate-300 italic">Sem descrição</span>}
                                            </td>
                                            <td className="px-6 py-3 text-center text-slate-500 text-xs uppercase bg-slate-50/50 rounded m-2">
                                                {item.unit || '-'}
                                            </td>
                                            <td className="px-6 py-3 text-right text-slate-600 text-sm tabular-nums">
                                                {(item.quantity || 0).toLocaleString('pt-BR')}
                                            </td>
                                            <td className="px-6 py-3 text-right text-slate-600 text-sm tabular-nums font-mono bg-slate-50/30">
                                                {(item.unit_price || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                            </td>
                                            <td className="px-6 py-3 text-right text-slate-900 font-semibold text-sm tabular-nums font-mono">
                                                {(item.total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                            </td>
                                            <td className="px-6 py-3 text-center">
                                                {item.confidence !== null ? (
                                                    <div className="flex items-center justify-center">
                                                        <div className={`
                                                                w-1.5 h-1.5 rounded-full mr-1.5
                                                                ${(item.confidence || 0) > 0.8 ? 'bg-green-500' : (item.confidence || 0) > 0.5 ? 'bg-amber-400' : 'bg-red-500'}
                                                            `}></div>
                                                        <span className={`text-xs font-medium ${(item.confidence || 0) > 0.8 ? 'text-green-700' : (item.confidence || 0) > 0.5 ? 'text-amber-700' : 'text-red-700'}`}>
                                                            {Math.round((item.confidence || 0) * 100)}%
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-300">-</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </div>

    );
}

// RECREATED
