import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { AiImportItem } from '../features/importer/types';
import { Loader2, ArrowLeft, CheckCircle, AlertCircle, Wand2, FileSpreadsheet, Plus, Info, LayoutDashboard, Calculator, Hash, AlertTriangle, Link2Off } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toRelativePath } from '../utils/appUrl';

const BASES_NACIONAIS = ['SINAPI', 'SICRO'];

const BASES_REGIONAIS_DESTAQUE = [
    'SEINFRA-BA', 'ORSE', 'EMBASA', 'COELBA', 'SUDEB', 'SEINFRA-CE'
];

const BASES_OUTRAS = [
    'CPOS', 'FDE', 'EMOP', 'SUDECAP', 'SETOP', 'IOPES',
    'GOINFRA/AGETOP', 'SEDOP', 'AGETRAN', 'DEINFRA/SIE', 'SEIL'
];

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
    const [jobStage, setJobStage] = useState<string | null>(null);
    const [mostrarOutrasBases, setMostrarOutrasBases] = useState(false);
    const bdiAutoFilledRef = useRef(false);
    const [bdiDetectionInfo, setBdiDetectionInfo] = useState<{ clusters: { center: number; count: number; label: string }[]; total: number }>({ clusters: [], total: 0 });
    const [showBdiEspecial, setShowBdiEspecial] = useState(false);

    const [params, setParams] = useState({
        uf: 'BA',
        competence: '2025-01',
        bdi_percent: 0,
        encargo_mode: 'nao_desonerado',
        encargo_horista_percent: 0,
        encargo_mensalista_percent: 0,
        bases_selecionadas: ['SINAPI'] as string[],
        bases_refs: {} as Record<string, string>,
        bdi_equipamentos: 0,
        bdi_especial: 0,
        bdi_especial_label: '',
        obra_nome: '',
        municipio: ''
    });

    useEffect(() => {
        fetchItems();
        fetchJobContext();

        // Polling: verifica stage a cada 10s até finalizar
        // NOTA: o intervalo é 10000ms. Se aparecerem ticks mais rápidos no
        // console, significa que múltiplas instâncias do componente estão
        // ativas simultaneamente (StrictMode em dev monta 2x, ou o componente
        // está sendo re-montado por rota pai).
        const prevStageRef = { current: jobStage };
        const interval = setInterval(async () => {
            console.log('[POLLING] tick — jobId:', jobId);
            const { data } = await supabase
                .from('import_jobs' as any)
                .select('stage, status, result_budget_id')
                .eq('id', jobId)
                .single();

            if (data) {
                const prevStage = prevStageRef.current;
                setJobStage(data.stage);
                prevStageRef.current = data.stage;

                // Parar polling em stages terminais da revisão (itens já carregados)
                const terminalStages = ['pending_hydration', 'extraction_complete', 'finalized'];

                // Recarregar itens quando stage avança para um estado terminal
                if (data.stage !== prevStage && terminalStages.includes(data.stage)) {
                    fetchItems();
                }

                // Parar polling quando a extração já está completa e na revisão
                if (['extraction_complete', 'pending_hydration'].includes(data.stage)) {
                    console.log('[POLLING] stage terminal de revisão atingido, parando polling:', data.stage);
                    clearInterval(interval);
                    // Budget já criado em pending_hydration → navega direto pro orçamento
                    if (data.result_budget_id && data.stage === 'pending_hydration') {
                        navigate(toRelativePath(`/budgets/${data.result_budget_id}`));
                    }
                    return;
                }

                if (data.result_budget_id && data.stage === 'finalized') {
                    console.log('[POLLING] finalized, parando polling e navegando.');
                    clearInterval(interval);
                    navigate(toRelativePath(`/budgets/${data.result_budget_id}`));
                }
            }
        }, 10000);

        return () => clearInterval(interval);
    }, [jobId]);


    const fetchJobContext = async () => {
        const { data } = await supabase
            .from('import_jobs' as any)
            .select('document_context, stage, status, result_budget_id')
            .eq('id', jobId)
            .single();
        if (data) {
            if (data.document_context) setJobContext(data.document_context);
            setJobStage(data.stage);
            // Se já tem budget gerado, redireciona direto
            if (data.result_budget_id && data.stage === 'finalized') {
                navigate(toRelativePath(`/budgets/${data.result_budget_id}`));
            }
        }
    };

    const fetchItems = async () => {
        try {
            setLoading(true);
            // Fetch from import_ai_items (Phase 2 output)
            const { data, error } = await supabase
                .from('import_ai_items' as any)
                .select('*')
                .eq('job_id', jobId)
                .order('idx', { ascending: true });

            if (error) throw error;
            setItems(data || []);

            // === AUTO-DETECT BDI (somente no primeiro carregamento) ===
            if (!bdiAutoFilledRef.current && data && data.length > 0) {
                const detections: number[] = [];
                for (const item of data) {
                    const qty = parseFloat(item.quantity) || 0;
                    const price = parseFloat(item.unit_price) || 0;
                    const total = parseFloat(item.total) || 0;
                    if (qty > 0 && price > 0 && total > 0) {
                        const expected = qty * price;
                        const ratio = total / expected;
                        if (ratio > 1.01 && ratio < 2.0) {
                            detections.push(ratio - 1);
                        }
                    }
                }

                if (detections.length > 0) {
                    const clusters: { center: number; count: number; label: string }[] = [];
                    for (const bdi of detections) {
                        const match = clusters.find(c => Math.abs(c.center - bdi) <= 0.02);
                        if (match) {
                            match.center = (match.center * match.count + bdi) / (match.count + 1);
                            match.count++;
                        } else {
                            clusters.push({ center: bdi, count: 1, label: '' });
                        }
                    }
                    clusters.sort((a, b) => b.count - a.count);

                    if (clusters.length >= 1) clusters[0].label = 'BDI Geral';
                    if (clusters.length >= 2) clusters[1].label = 'BDI Equipamentos';
                    if (clusters.length >= 3) clusters[2].label = 'BDI Especial';

                    setBdiDetectionInfo({ clusters, total: detections.length });

                    const round2 = (n: number) => Math.round(n * 10000) / 100;
                    const updates: Record<string, any> = {};
                    if (clusters.length >= 1) updates.bdi_percent = round2(clusters[0].center);
                    if (clusters.length >= 2 && Math.abs(clusters[0].center - clusters[1].center) > 0.02) {
                        updates.bdi_equipamentos = round2(clusters[1].center);
                    }
                    if (clusters.length >= 3 && Math.abs(clusters[0].center - clusters[2].center) > 0.02) {
                        updates.bdi_especial = round2(clusters[2].center);
                        setShowBdiEspecial(true);
                    }

                    if (Object.keys(updates).length > 0) {
                        setParams(prev => ({ ...prev, ...updates }));
                    }
                }
                bdiAutoFilledRef.current = true;
            }

        } catch (err: any) {
            console.error('Fetch error:', err);
            setError(err.message || 'Erro ao carregar itens.');
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateBudget = async () => {
        if (!jobId) return;

        if (params.bdi_percent === 0) {
            const proceed = window.confirm(
                'BDI não informado — deseja continuar com 0%?\n\n' +
                'O orçamento será gerado sem incidência de BDI sobre os preços unitários.'
            );
            if (!proceed) return;
        }

        setGenerating(true);

        try {
            console.log('=== BDI DEBUG ===', {
                bdi_percent: params.bdi_percent,
                bdi_mode_value: params.bdi_percent,
                typeof_bdi: typeof params.bdi_percent,
                bdi_equipamentos: params.bdi_equipamentos,
                bdi_especial: params.bdi_especial,
                full_body: {
                    job_id: jobId,
                    bdi_mode: params.bdi_percent,
                    bdi_rates: [
                        { label: 'BDI Geral', value: params.bdi_percent, is_default: true },
                        ...(params.bdi_equipamentos > 0 ? [{ label: 'BDI Equipamentos', value: params.bdi_equipamentos }] : []),
                        ...(params.bdi_especial >= 1 ? [{ label: params.bdi_especial_label || 'BDI Especial', value: params.bdi_especial }] : [])
                    ],
                    bdi_equipamentos: params.bdi_equipamentos
                }
            });

            const { data, error } = await supabase.functions.invoke('import-finalize-budget', {
                body: {
                    job_id: jobId,
                    import_job_id: jobId,
                    uf: params.uf,
                    competence: Object.values(params.bases_refs)[0] || params.competence || '2025-01',
                    bases_refs: params.bases_refs,
                    desonerado: params.encargo_mode === 'desonerado',
                    bdi_mode: params.bdi_percent,
                    social_charges: {
                        horista: params.encargo_horista_percent,
                        mensalista: params.encargo_mensalista_percent
                    },
                    enable_structure_parser_v1: true,
                    bdi_equipamentos: params.bdi_equipamentos,
                    bdi_especial: params.bdi_especial,
                    bdi_rates: [
                        { label: 'BDI Geral', value: params.bdi_percent, is_default: true },
                        ...(params.bdi_equipamentos > 0 ? [{ label: 'BDI Equipamentos', value: params.bdi_equipamentos }] : []),
                        ...(params.bdi_especial >= 1 ? [{ label: params.bdi_especial_label || 'BDI Especial', value: params.bdi_especial }] : [])
                    ],
                    obra_nome: params.obra_nome,
                    municipio: params.municipio,
                    bases_selecionadas: params.bases_selecionadas
                }
            });

            if (error) {
                throw new Error(error.message || "Erro na chamada da função");
            }

            const result = data;

            if (result?.ok === false) {
                if (result?.reason === 'no_items_found') {
                    alert("Atenção: Nenhum item foi encontrado para gerar o orçamento.");
                    return;
                }
                throw new Error(result.details || result.reason || "Erro desconhecido no processamento.");
            }

            // Fluxo assíncrono: polling até result_budget_id aparecer
            if (result?.async === true || result?.status === 'processing') {
                let attempts = 0;
                const maxAttempts = 80; // 80 x 5s = 400s
                const poll = async (): Promise<void> => {
                    if (attempts >= maxAttempts) {
                        throw new Error("Tempo limite excedido aguardando geração do orçamento.");
                    }
                    attempts++;
                    const { data: jobData } = await supabase
                        .from('import_jobs' as any)
                        .select('result_budget_id, stage')
                        .eq('id', jobId)
                        .single();
                    if (jobData?.result_budget_id && ['pending_hydration', 'finalized'].includes(jobData?.stage)) {
                        navigate(toRelativePath(`/budgets/${jobData.result_budget_id}`));
                        return;
                    }
                    await new Promise(res => setTimeout(res, 5000));
                    return poll();
                };
                await poll();
                return;
            }

            // Fluxo síncrono legado
            if (!result?.budget_id) {
                throw new Error("Resposta inválida do servidor (Budget ID ausente).");
            }
            navigate(toRelativePath(`/budgets/${result.budget_id}`));

        } catch (err: any) {
            console.error("Generate Error:", err);
            const msg = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
            alert(`Falha ao gerar orçamento: ${msg}`);
        } finally {
            setGenerating(false);
        }
    };

    const [isAddingManual, setIsAddingManual] = useState(false);
    const [manualItem, setManualItem] = useState({
        description: '',
        unit: 'UN',
        quantity: 1,
        unit_price: 0
    });

    const handleSaveManualItem = async () => {
        if (!manualItem.description) {
            alert("A descrição é obrigatória.");
            return;
        }

        try {
            setGenerating(true);

            // 1. Get correct file ID (required FK)
            const { data: fileData, error: fileError } = await supabase
                .from('import_files' as any)
                .select('id')
                .eq('job_id', jobId)
                .limit(1)
                .single();

            if (fileError || !fileData) throw new Error("Não foi possivel vincular ao arquivo da importação.");

            const nextIdx = (items.length || 0) + 1;

            const row = {
                job_id: jobId,
                import_file_id: fileData.id,
                idx: nextIdx,
                description: manualItem.description,
                unit: manualItem.unit,
                quantity: manualItem.quantity,
                unit_price: manualItem.unit_price,
                total: manualItem.quantity * manualItem.unit_price,
                confidence: 1.0,
            };

            const { error: insertError } = await supabase
                .from('import_ai_items' as any)
                .insert(row);

            if (insertError) throw insertError;

            await fetchItems();

            setIsAddingManual(false);
            setManualItem({ description: '', unit: 'UN', quantity: 1, unit_price: 0 });

        } catch (e: any) {
            console.error("Manual Insert Error:", e);
            alert("Erro ao salvar item: " + e.message);
        } finally {
            setGenerating(false);
        }
    };

    const toggleBase = (base: string) => {
        setParams(prev => {
            const selecionadas = prev.bases_selecionadas;
            if (selecionadas.includes(base)) {
                const newRefs = { ...prev.bases_refs };
                delete newRefs[base];
                return { ...prev, bases_selecionadas: selecionadas.filter(b => b !== base), bases_refs: newRefs };
            } else {
                const defaultRef = base.startsWith('SEINFRA') ? '028' : prev.competence || '2025-01';
                return {
                    ...prev,
                    bases_selecionadas: [...selecionadas, base],
                    bases_refs: { ...prev.bases_refs, [base]: defaultRef }
                };
            }
        });
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

    const valorTotal = items.reduce((acc, item) => acc + ((item.quantity || 0) * (item.unit_price || 0)), 0);
    const itensExtraidos = items.length;
    const comAlertas = items.filter(i => i.warnings && Object.keys(i.warnings).length > 0).length;
    const naoVinculados = items.filter(i => !i.price_source).length;

    const baseCounts = items.reduce((acc: Record<string, number>, item) => {
        const source = item.price_source || 'Não vinculado';
        acc[source] = (acc[source] || 0) + 1;
        return acc;
    }, {});

    const baseColors: Record<string, string> = {
        'SINAPI': 'bg-blue-500',
        'ORSE': 'bg-green-500',
        'Não vinculado': 'bg-orange-500',
        'Próprio': 'bg-slate-500',
        'Manual': 'bg-purple-500'
    };

    const BaseRefInput = ({ base }: { base: string }) => {
        if (!params.bases_selecionadas.includes(base)) return null;
        if (base.startsWith('SEINFRA')) {
            return (
                <select
                    value={params.bases_refs[base] || '028'}
                    onChange={e => setParams(prev => ({
                        ...prev,
                        bases_refs: { ...prev.bases_refs, [base]: e.target.value }
                    }))}
                    className="px-2 py-1.5 border border-slate-200 rounded-lg bg-white text-xs font-medium focus:border-blue-500 outline-none"
                >
                    <option value="023.1">023.1</option>
                    <option value="025">025</option>
                    <option value="026">026</option>
                    <option value="027">027</option>
                    <option value="028">028</option>
                </select>
            );
        }
        return (
            <input
                type="month"
                value={params.bases_refs[base] || params.competence || '2025-01'}
                onChange={e => setParams(prev => ({
                    ...prev,
                    bases_refs: { ...prev.bases_refs, [base]: e.target.value }
                }))}
                className="px-2 py-1.5 border border-slate-200 rounded-lg bg-white text-xs font-medium focus:border-blue-500 outline-none w-36"
            />
        );
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            {/* A) Cabeçalho Fixo de Resumo */}
            <header className="bg-white border-b border-slate-200 sticky top-0 z-40 px-6 py-4">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                            <Wand2 className="text-blue-600" size={24} />
                            Revisão da Importação
                        </h1>
                        <p className="text-slate-500 text-xs mt-1 font-mono">Job ID: {jobId}</p>
                    </div>
                    <div className="flex gap-4 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
                        <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl min-w-[140px] flex-shrink-0">
                            <div className="flex items-center gap-2 text-slate-500 mb-1">
                                <Calculator size={14} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Valor Bruto Extraído</span>
                            </div>
                            <div className="font-bold text-slate-800 truncate">
                                {valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </div>
                        </div>
                        <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl min-w-[120px] flex-shrink-0">
                            <div className="flex items-center gap-2 text-slate-500 mb-1">
                                <Hash size={14} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Itens Extraídos</span>
                            </div>
                            <div className="font-bold text-slate-800">
                                {itensExtraidos}
                            </div>
                        </div>
                        <div className={`p-3 rounded-xl min-w-[120px] flex-shrink-0 border ${comAlertas > 0 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
                            <div className={`flex items-center gap-2 mb-1 ${comAlertas > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                                <AlertTriangle size={14} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Com Alertas</span>
                            </div>
                            <div className={`font-bold ${comAlertas > 0 ? 'text-amber-700' : 'text-slate-800'}`}>
                                {comAlertas}
                            </div>
                        </div>
                        <div className={`p-3 rounded-xl min-w-[120px] flex-shrink-0 border ${naoVinculados > 0 ? 'bg-orange-50 border-orange-200' : 'bg-slate-50 border-slate-100'}`}>
                            <div className={`flex items-center gap-2 mb-1 ${naoVinculados > 0 ? 'text-orange-600' : 'text-slate-500'}`}>
                                <Link2Off size={14} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Não Vinculados</span>
                            </div>
                            <div className={`font-bold ${naoVinculados > 0 ? 'text-orange-700' : 'text-slate-800'}`}>
                                {naoVinculados}
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Aviso de divergência pré/pós-processamento */}
            {(jobStage === 'pending_hydration' || jobStage === 'finalized') && (
                <div className="max-w-7xl mx-auto w-full px-4 md:px-6 mt-3">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                        <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={18} />
                        <div>
                            <p className="text-sm font-bold text-amber-800">Valores estimados</p>
                            <p className="text-xs text-amber-700 mt-1">
                                Os valores exibidos acima são estimativas da extração automática.
                                O orçamento final pode apresentar pequenas diferenças após o processamento.
                                Consulte a tela do orçamento para os valores definitivos.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 space-y-6">

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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* B) Bloco "Identificação" */}
                    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
                        <div>
                            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4">Identificação do Orçamento</h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome da Obra / Orçamento</label>
                                    <input
                                        type="text"
                                        className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-blue-500 outline-none transition-colors font-medium text-sm"
                                        placeholder="Ex: Construção de Escola Municipal..."
                                        value={params.obra_nome}
                                        onChange={e => { const v = e.target.value; setParams(prev => ({ ...prev, obra_nome: v })); }}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Estado (UF)</label>
                                        <select
                                            className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-blue-500 outline-none transition-colors font-medium text-sm"
                                            value={params.uf}
                                            onChange={e => { const v = e.target.value; setParams(prev => ({ ...prev, uf: v })); }}
                                        >
                                            <option value="AC">Acre (AC)</option>
                                            <option value="AL">Alagoas (AL)</option>
                                            <option value="AP">Amapá (AP)</option>
                                            <option value="AM">Amazonas (AM)</option>
                                            <option value="BA">Bahia (BA)</option>
                                            <option value="CE">Ceará (CE)</option>
                                            <option value="DF">Distrito Federal (DF)</option>
                                            <option value="ES">Espírito Santo (ES)</option>
                                            <option value="GO">Goiás (GO)</option>
                                            <option value="MA">Maranhão (MA)</option>
                                            <option value="MT">Mato Grosso (MT)</option>
                                            <option value="MS">Mato Grosso do Sul (MS)</option>
                                            <option value="MG">Minas Gerais (MG)</option>
                                            <option value="PA">Pará (PA)</option>
                                            <option value="PB">Paraíba (PB)</option>
                                            <option value="PR">Paraná (PR)</option>
                                            <option value="PE">Pernambuco (PE)</option>
                                            <option value="PI">Piauí (PI)</option>
                                            <option value="RJ">Rio de Janeiro (RJ)</option>
                                            <option value="RN">Rio Grande do Norte (RN)</option>
                                            <option value="RS">Rio Grande do Sul (RS)</option>
                                            <option value="RO">Rondônia (RO)</option>
                                            <option value="RR">Roraima (RR)</option>
                                            <option value="SC">Santa Catarina (SC)</option>
                                            <option value="SP">São Paulo (SP)</option>
                                            <option value="SE">Sergipe (SE)</option>
                                            <option value="TO">Tocantins (TO)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Município (Opcional)</label>
                                        <input
                                            type="text"
                                            className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-blue-500 outline-none transition-colors font-medium text-sm"
                                            placeholder="Ex: Salvador"
                                            value={params.municipio}
                                            onChange={e => { const v = e.target.value; setParams(prev => ({ ...prev, municipio: v })); }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* E) Bloco "Bases de Preço" */}
                    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
                        <div>
                            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4">Bases de Preço</h2>
                            <div className="space-y-5">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Bases Nacionais</label>
                                    <div className="flex flex-wrap gap-2">
                                        {BASES_NACIONAIS.map(base => (
                                            <div key={base} className="flex items-center gap-2">
                                                <button
                                                    onClick={() => toggleBase(base)}
                                                    className={`px-4 py-2 rounded-lg text-xs font-bold border transition-all ${params.bases_selecionadas.includes(base) ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-200' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}
                                                >
                                                    {base}
                                                </button>
                                                <BaseRefInput base={base} />
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Bases Regionais</label>
                                    <div className="flex flex-wrap gap-2">
                                        {BASES_REGIONAIS_DESTAQUE.map(base => (
                                            <div key={base} className="flex items-center gap-2">
                                                <button
                                                    onClick={() => toggleBase(base)}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${params.bases_selecionadas.includes(base) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}
                                                >
                                                    {base}
                                                </button>
                                                <BaseRefInput base={base} />
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {!mostrarOutrasBases ? (
                                    <button
                                        onClick={() => setMostrarOutrasBases(true)}
                                        className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-2 px-2 py-1 rounded bg-blue-50/50 hover:bg-blue-100 transition-colors"
                                    >
                                        <Plus size={12} /> Exibir outras bases
                                    </button>
                                ) : (
                                    <div className="pt-2 animate-in fade-in duration-300">
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Outras Bases</label>
                                        <div className="flex flex-wrap gap-2">
                                            {BASES_OUTRAS.map(base => (
                                                <div key={base} className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => toggleBase(base)}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${params.bases_selecionadas.includes(base) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}
                                                    >
                                                        {base}
                                                    </button>
                                                    <BaseRefInput base={base} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* C) Bloco "Regime e Encargos" */}
                    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
                        <div>
                            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4">Regime e Encargos Sociais</h2>
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Regime</label>
                                        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl h-[46px]">
                                            <button
                                                className={`flex-1 text-xs font-bold py-1 px-2 rounded-lg transition-all ${params.encargo_mode === 'nao_desonerado' ? 'bg-white text-slate-900 shadow-sm border border-white' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
                                                onClick={() => setParams(prev => ({ ...prev, encargo_mode: 'nao_desonerado' }))}
                                            >
                                                Não Des.
                                            </button>
                                            <button
                                                className={`flex-1 text-xs font-bold py-1 px-2 rounded-lg transition-all ${params.encargo_mode === 'desonerado' ? 'bg-white text-slate-900 shadow-sm border border-white' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
                                                onClick={() => setParams(prev => ({ ...prev, encargo_mode: 'desonerado' }))}
                                            >
                                                Desonerado
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Encargos Horista (%)</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-blue-500 outline-none transition-colors font-medium text-sm pr-8"
                                                value={params.encargo_horista_percent}
                                                onChange={e => { const v = parseFloat(e.target.value) || 0; setParams(prev => ({ ...prev, encargo_horista_percent: v })); }}
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Encargos Mensalista (%)</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-blue-500 outline-none transition-colors font-medium text-sm pr-8"
                                                value={params.encargo_mensalista_percent}
                                                onChange={e => { const v = parseFloat(e.target.value) || 0; setParams(prev => ({ ...prev, encargo_mensalista_percent: v })); }}
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* D) Bloco "BDI" */}
                    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
                        <div>
                            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4">Bonificação e Despesas Indiretas (BDI)</h2>
                            <div className={`grid gap-4 mb-4 ${showBdiEspecial || params.bdi_especial > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">BDI Geral (%)</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-blue-500 outline-none transition-colors font-medium text-sm pr-8 text-blue-800 focus:bg-blue-50/50"
                                            value={params.bdi_percent}
                                            onChange={e => { const v = parseFloat(e.target.value) || 0; setParams(prev => ({ ...prev, bdi_percent: v })); }}
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</span>
                                    </div>
                                    {bdiDetectionInfo.clusters[0] && (
                                        <p className="text-[10px] text-blue-500 mt-1 font-medium">Detectado em {bdiDetectionInfo.clusters[0].count} de {bdiDetectionInfo.total} itens</p>
                                    )}
                                    {(params.bdi_percent < 10 || params.bdi_percent > 40) && params.bdi_percent > 0 && (
                                        <p className="text-[10px] text-amber-600 mt-1 font-medium">⚠ Valor fora da faixa usual (10-40%)</p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">BDI Equipamentos (%)</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-orange-500 outline-none transition-colors font-medium text-sm pr-8 text-orange-800 focus:bg-orange-50/50"
                                            value={params.bdi_equipamentos}
                                            onChange={e => { const v = parseFloat(e.target.value) || 0; setParams(prev => ({ ...prev, bdi_equipamentos: v })); }}
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</span>
                                    </div>
                                    {bdiDetectionInfo.clusters[1] && (
                                        <p className="text-[10px] text-orange-500 mt-1 font-medium">Detectado em {bdiDetectionInfo.clusters[1].count} de {bdiDetectionInfo.total} itens</p>
                                    )}
                                    {(params.bdi_equipamentos < 10 || params.bdi_equipamentos > 40) && params.bdi_equipamentos > 0 && (
                                        <p className="text-[10px] text-amber-600 mt-1 font-medium">⚠ Valor fora da faixa usual (10-40%)</p>
                                    )}
                                </div>
                                {(showBdiEspecial || params.bdi_especial > 0) && (
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <input
                                                type="text"
                                                className="text-xs font-bold text-slate-500 uppercase bg-transparent border-b border-dashed border-slate-300 focus:border-emerald-500 outline-none w-full"
                                                value={params.bdi_especial_label || 'BDI Especial'}
                                                onChange={e => { const v = e.target.value; setParams(prev => ({ ...prev, bdi_especial_label: v })); }}
                                                placeholder="Nome da faixa"
                                            />
                                            <span className="text-[10px] text-slate-400">(%)</span>
                                        </div>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-emerald-500 outline-none transition-colors font-medium text-sm pr-8 text-emerald-800 focus:bg-emerald-50/50"
                                                value={params.bdi_especial}
                                                onChange={e => { const v = parseFloat(e.target.value) || 0; setParams(prev => ({ ...prev, bdi_especial: v })); }}
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</span>
                                        </div>
                                        {bdiDetectionInfo.clusters[2] && (
                                            <p className="text-[10px] text-emerald-500 mt-1 font-medium">Detectado em {bdiDetectionInfo.clusters[2].count} de {bdiDetectionInfo.total} itens</p>
                                        )}
                                        {(params.bdi_especial < 10 || params.bdi_especial > 40) && params.bdi_especial > 0 && (
                                            <p className="text-[10px] text-amber-600 mt-1 font-medium">⚠ Valor fora da faixa usual (10-40%)</p>
                                        )}
                                    </div>
                                )}
                            </div>
                            {!showBdiEspecial && params.bdi_especial === 0 && (
                                <button
                                    type="button"
                                    onClick={() => setShowBdiEspecial(true)}
                                    className="text-[11px] px-3 py-1.5 text-emerald-600 font-bold hover:bg-emerald-50 rounded-lg border border-emerald-200 transition-colors mb-4 flex items-center gap-1"
                                >
                                    <Plus size={12} /> Adicionar 3ª faixa de BDI
                                </button>
                            )}
                            <div className="flex items-start gap-3 text-slate-600 bg-slate-50/80 p-3.5 rounded-xl border border-slate-100">
                                <Info size={16} className="shrink-0 mt-0.5 text-blue-500" />
                                <p className="text-[11px] leading-relaxed">
                                    Os valores de BDI foram detectados automaticamente a partir dos itens do seu orçamento. Confira e ajuste se necessário.
                                </p>
                            </div>
                        </div>
                    </section>
                </div>

                {/* F) Bloco "Resumo dos Itens" (Substitui tabela) */}
                <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">Resumo dos Itens ({itensExtraidos})</h2>
                        <button
                            onClick={() => setIsAddingManual(true)}
                            className="text-[11px] px-4 py-2 bg-slate-100 font-bold text-slate-600 rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-2"
                        >
                            <Plus size={14} /> Adicionar manual
                        </button>
                    </div>

                    {itensExtraidos > 0 && (
                        <div className="mb-6 h-3.5 w-full flex rounded-full overflow-hidden bg-slate-100 border border-slate-200/50 shadow-inner">
                            {Object.entries(baseCounts).map(([source, count], i) => {
                                const width = `${((count as number) / itensExtraidos) * 100}%`;
                                const colorClass = baseColors[source] || 'bg-slate-400';
                                return <div key={source} style={{ width }} className={colorClass} title={`${source}: ${count}`} />;
                            })}
                        </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        {Object.entries(baseCounts).map(([source, count]) => {
                            const colorClass = baseColors[source] ? baseColors[source].replace('bg-', 'text-') : 'text-slate-500';
                            const bgColorClass = baseColors[source] ? baseColors[source].replace('bg-', 'bg-').replace('500', '50') : 'bg-slate-50';
                            const borderColorClass = baseColors[source] ? baseColors[source].replace('bg-', 'border-').replace('500', '100') : 'border-slate-100';
                            return (
                                <div key={source} className={`p-4 rounded-xl border ${borderColorClass} ${bgColorClass} flex items-center justify-between`}>
                                    <span className={`text-[10px] font-black uppercase tracking-widest ${colorClass}`}>{source}</span>
                                    <span className={`text-lg font-black ${colorClass}`}>{count}</span>
                                </div>
                            );
                        })}
                    </div>

                    {comAlertas > 0 && (
                        <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center gap-4 mt-2">
                            <div className="bg-amber-100 p-2.5 rounded-xl text-amber-600 shadow-sm border border-amber-100">
                                <AlertTriangle size={20} />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-amber-800">Atenção com {comAlertas} itens alertados</p>
                                <p className="text-xs text-amber-700/80 mt-0.5">Revise o orçamento após a importação para checar unidades incompatíveis ou referências imprecisas.</p>
                            </div>
                        </div>
                    )}
                </section>

                {/* Spacer padding for footer */}
                <div className="h-8"></div>
            </main>

            {/* G) Botão de ação sticky (Rodapé) */}
            <div className="sticky bottom-0 bg-white border-t border-slate-200 p-4 z-40 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
                <div className="max-w-7xl mx-auto w-full flex justify-between items-center px-2">
                    <button
                        onClick={() => navigate('/budgets')}
                        className="text-slate-500 hover:text-slate-800 font-bold text-sm px-4 py-2 flex items-center gap-2 transition-colors rounded-lg hover:bg-slate-50"
                    >
                        <ArrowLeft size={16} /> Cancelar Importação
                    </button>
                    <button
                        onClick={handleGenerateBudget}
                        disabled={generating || items.length === 0}
                        className="bg-blue-600 text-white px-6 md:px-8 py-3.5 rounded-xl font-black text-[13px] md:text-sm flex items-center gap-3 hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-600/20 active:scale-95 border border-blue-500"
                    >
                        {generating ? <Loader2 className="animate-spin" size={20} /> : <FileSpreadsheet size={20} />}
                        {generating ? 'GERANDO ORÇAMENTO...' : 'GERAR ORÇAMENTO FINAL'}
                    </button>
                </div>
            </div>

            {/* Modal Manual Item */}
            {isAddingManual && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 animate-in zoom-in-95 duration-200">
                        <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-3">
                            <div className="bg-blue-50 p-2 rounded-lg"><Plus size={20} className="text-blue-600" /></div>
                            Adicionar Item Manual
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Descrição</label>
                                <input
                                    type="text"
                                    className="w-full p-3.5 border border-slate-200 bg-slate-50 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-medium"
                                    placeholder="Ex: Concreto Armado fck=25MPa"
                                    value={manualItem.description}
                                    onChange={e => setManualItem({ ...manualItem, description: e.target.value })}
                                    autoFocus
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Unidade</label>
                                    <input
                                        type="text"
                                        className="w-full p-3.5 border border-slate-200 bg-slate-50 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none uppercase transition-all text-center font-bold text-sm"
                                        placeholder="UN"
                                        value={manualItem.unit}
                                        onChange={e => setManualItem({ ...manualItem, unit: e.target.value })}
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Quantidade</label>
                                    <input
                                        type="number"
                                        className="w-full p-3.5 border border-slate-200 bg-slate-50 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono text-sm"
                                        value={manualItem.quantity}
                                        onChange={e => setManualItem({ ...manualItem, quantity: parseFloat(e.target.value) || 0 })}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Preço Unitário (R$)</label>
                                <input
                                    type="number"
                                    className="w-full p-3.5 border border-slate-200 bg-slate-50 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono text-sm"
                                    value={manualItem.unit_price}
                                    onChange={e => setManualItem({ ...manualItem, unit_price: parseFloat(e.target.value) || 0 })}
                                />
                            </div>

                            <div className="bg-blue-50 p-4 rounded-xl flex justify-between items-center mt-6 border border-blue-100">
                                <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Total Estimado</span>
                                <span className="text-xl font-black text-blue-800 font-mono">
                                    {(manualItem.quantity * manualItem.unit_price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </span>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-slate-100">
                            <button
                                onClick={() => setIsAddingManual(false)}
                                className="px-5 py-3 text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-transparent hover:border-slate-200 rounded-xl font-bold transition-all text-sm"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSaveManualItem}
                                disabled={generating}
                                className="px-6 py-3 bg-blue-600 text-white rounded-xl font-black hover:bg-blue-700 disabled:opacity-50 transition-all shadow-lg shadow-blue-600/20 text-sm border border-blue-500"
                            >
                                {generating ? 'Adicionando...' : 'Adicionar Item'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
