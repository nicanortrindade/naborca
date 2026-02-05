
import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2, AlertCircle, CheckCircle2, FileText, ArrowLeft, Download, Sparkles } from 'lucide-react';
import type { ImportJob } from '../features/importer/types';
import ImportReviewPage from './ImportReviewPage';
import { saveAs } from 'file-saver';
import { toRelativePath } from '../utils/appUrl';

// --- TYPES ---
type UIStatus =
    | 'loading'
    | 'queued'
    | 'ocr_running'
    | 'ocr_success'
    | 'ocr_success_with_warn'
    | 'ocr_empty'
    | 'failed'
    | 'review_ready'
    | 'retryable'
    | 'unknown_but_renderable'
    | 'extraction_failed_action'
    | 'applying'
    | 'finalizing';

interface ExtendedImportFile {
    id: string;
    job_id: string;
    storage_path: string;
    original_filename: string;
    extracted_text?: string;
    extracted_json?: any;
    extracted_completed_at?: string;
    metadata?: any;
    created_at: string;
}

export default function ImportStatus() {
    const { id } = useParams<{ id: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const isDebug = searchParams.get('debug') === '1';

    // Data State
    const [job, setJob] = useState<ImportJob | null>(null);
    const [file, setFile] = useState<ExtendedImportFile | null>(null);
    const [uiStatus, setUiStatus] = useState<UIStatus>('loading');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [warningMessage, setWarningMessage] = useState<string | null>(null);

    // Interaction State
    const [isExtracting, setIsExtracting] = useState(false);
    const [showPreview, setShowPreview] = useState(false);

    // Polling Ref
    const pollIntervalRef = useRef<number | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // --- 1. DATA FETCHING ---
    const fetchData = useCallback(async () => {
        if (!id) return;

        if (abortRef.current) abortRef.current.abort();
        abortRef.current = new AbortController();

        try {
            // A. Fetch Job
            const { data: jobData, error: jobError } = await (supabase
                .from('import_jobs' as any) as any)
                .select('*')
                .eq('id', id)
                .abortSignal(abortRef.current.signal)
                .single();

            if (jobError) throw jobError;

            // PRIORITY REDIRECT: IF BUDGET EXISTS, GO THERE (Ignore status)
            if ((jobData as any)?.result_budget_id) {
                console.log("[ImportStatus] Budget ready, redirecting:", (jobData as any).result_budget_id);
                navigate(toRelativePath(`/budgets/${(jobData as any).result_budget_id}`));
                return; // Stop processing
            }

            // B. Fetch Latest File
            const { data: fileData, error: fileError } = await (supabase
                .from('import_files' as any)
                .select('id, job_id, storage_path, original_filename, extracted_text, extracted_json, extracted_completed_at, metadata, created_at')
                .eq('job_id', id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle() as any);

            if (fileError) console.warn("[ImportStatus] Error fetching file:", fileError);

            // B.1 Fetch Item Count (REGRA ABSOLUTA)
            // Alterado para 'import_ai_items' (Source of Truth do Worker)
            const { count: itemsCount } = await (supabase
                .from('import_ai_items' as any)
                .select('*', { count: 'exact', head: true })
                .eq('job_id', id) as any);

            // C. Derive Status
            const derived = deriveUiStatus(jobData, fileData, itemsCount || 0);

            // State Updates
            setJob(jobData);
            setFile(fileData);
            setUiStatus(derived.status);
            setErrorMessage(derived.error || null);
            setWarningMessage(derived.warning || null);

        } catch (err: any) {
            if (err.name === 'AbortError') return;
            console.error('[ImportStatus] Fetch error:', err);
            // Non-fatal, just don't update if transient. 
            // If job is null (first load), then fatal.
            if (!job) {
                setUiStatus('failed'); // We only completely fail if we can't load the job
                setErrorMessage(err.message || 'Erro de conexão.');
            }
        }
    }, [id, job]);

    // --- 2. POLLING ---
    useEffect(() => {
        if (!id) return;
        fetchData();

        pollIntervalRef.current = window.setInterval(async () => {
            // Re-fetch data
            await fetchData();
        }, 3000);

        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            if (abortRef.current) abortRef.current.abort();
        };
    }, [id]);

    useEffect(() => {
        const isFinal = ['ocr_success', 'ocr_success_with_warn', 'ocr_empty', 'review_ready', 'failed', 'extraction_failed_action'].includes(uiStatus);

        // Keep polling if we are in transient states like applying or prioritizing
        const isTransient = ['applying', 'finalizing', 'queued', 'ocr_running'].includes(uiStatus);

        if (isFinal && !isTransient && pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }

        // PRIORITY NAVIGATION: If budget exists, go there immediately
        if ((job as any)?.result_budget_id) {
            console.log("Redirecting to existing budget:", (job as any).result_budget_id);
            navigate(toRelativePath(`/budgets/${(job as any).result_budget_id}`));
        }

    }, [uiStatus, id, job]);


    // --- 3. STATUS DERIVATION (MATCHING BACKEND LOGIC) ---
    const deriveUiStatus = (j: ImportJob, f: ExtendedImportFile | null, itemsCount: number = 0): {
        status: UIStatus,
        error?: string,
        warning?: string
    } => {
        // REGRA ABSOLUTA: Se existir pelo menos 1 item, o job está pronto para revisão
        // Isso resolve o bug onde o status do job ou do OCR pode estar atrasado/preso
        if (itemsCount > 0) {
            return { status: "review_ready" };
        }

        // PRIORITY 1: Budget Already Created (Success)
        // If the backend created a budget, we don't care about job status failures.
        if ((j as any)?.result_budget_id) {
            console.log("[ImportStatus] Budget found, ignoring status variants.");
            return { status: "review_ready" };
        }

        // PRIORITY 1.1: Explicit DONE but missing link (Finalizing state)
        if (j?.status === 'done' && !(j as any)?.result_budget_id) {
            return { status: "finalizing" };
        }

        // PRIORITY 2: Extraction Failed (User Action Required)
        const userAction = (j as any)?.document_context?.user_action;
        if (
            (j?.status === 'waiting_user' && j?.current_step === 'waiting_user_extraction_failed') ||
            (j?.status === 'waiting_user_extraction_failed') ||
            (userAction?.reason === 'extraction_failed')
        ) {
            return { status: "extraction_failed_action" };
        }

        const textLen = f?.extracted_text?.length ?? 0;
        const ocr = f?.metadata?.ocr;

        // ... rest of logic for extracting items ...
        if (f?.extracted_completed_at) {
            return { status: "review_ready" };
        }

        // RETRYABLE EXTRACTION (Phase 2.2 Bonus)
        const jobExtra = j as any;
        if (jobExtra?.extraction_retryable) {
            const reason = jobExtra.extraction_last_reason;
            let msg = "IA indisponível no momento.";
            if (reason === 'watchdog_timeout_processing') msg = "Instabilidade no processamento detectada.";

            return {
                status: "retryable",
                warning: msg
            };
        }

        // REGRA SUPREMA — TEXTO EXISTE = SUCESSO
        if (textLen > 50) {
            const hasHistoricError =
                j?.status === "failed" ||
                String(j?.last_error || "").includes("watchdog");

            if (hasHistoricError) {
                return {
                    status: "ocr_success_with_warn",
                    warning: "O processamento demorou, mas o texto foi recuperado com sucesso."
                };
            }

            return { status: "ocr_success" };
        }

        // OCR EM ANDAMENTO
        if (ocr?.request_id && !ocr?.completed_at) {
            return { status: "ocr_running" };
        }

        // OCR FINALIZOU SEM TEXTO
        if (ocr?.completed_at && textLen <= 50) {
            return { status: "ocr_empty" };
        }

        // STATUS DE PROGRESSO/FILA (Queued, Applying, Finalizing)
        if (j?.status === "processing") return { status: "queued" };
        if (j?.status === "queued") return { status: "queued" };
        if (j?.status === "applying") return { status: "applying" };

        // Done but no Budget ID yet -> Finalizing
        if (j?.status === "done" && !(j as any)?.result_budget_id) {
            return { status: "finalizing" };
        }

        // CRITICAL FIX: Treat 'failed' as recoverable manual entry
        if (j?.status === "failed") {
            // Check if it's a hard technical error we can't recover from (rare)
            // For now, we assume ALL processing failures are recoverable via manual entry
            return {
                status: "extraction_failed_action",
                warning: j?.last_error || "Processamento automático falhou."
            };
        }

        // NEW: Specific handle for rate limiting (Terminal but waiting)
        if (j?.status === 'waiting_user_rate_limited') {
            return {
                status: "retryable",
                warning: "Limite de IA atingido. O processamento será retomado automaticamente."
            };
        }

        // Se status === 'waiting_user' ou subtipos não capturados, trata como ação necessária
        if (typeof j?.status === 'string' && j.status.startsWith("waiting_user")) {
            return { status: "extraction_failed_action" };
        }

        // FALLBACK DE SEGURANÇA (NUNCA LIMBO)
        console.warn("[ImportStatus] Estado inconsistente detectado:", j?.status);
        return {
            status: "unknown_but_renderable",
            warning: "Estado inconsistente. Recarregue a página."
        };
    };

    // --- Actions ---
    const handleExtractItems = async () => {
        if (!job || !file) return;
        try {
            setIsExtracting(true);
            setErrorMessage(null);

            // Invoke Extraction Dispatcher (Secure)
            const { data, error } = await supabase.functions.invoke('import-extract', {
                body: { job_id: job.id }
            });

            if (error) throw error;

            // Handle retryable response from worker (legacy/direct)
            if (data?.retryable) {
                setWarningMessage(`IA temporariamente ocupada. Tentaremos novamente em breve.`);
                fetchData();
                return;
            }

            if (data?.status === 'failed' || data?.ok === false) throw new Error(data.message || "Falha na extração");

            fetchData();
        } catch (e: any) {
            console.error(e);
            setErrorMessage(e.message || "Erro na extração.");
        } finally {
            setIsExtracting(false);
        }
    };

    const handleRetryExtraction = async () => {
        if (!job) return;
        try {
            setIsExtracting(true);
            setErrorMessage(null);

            // Clean state via RPC
            const { error } = await (supabase as any).rpc('reprocess_extraction', { p_job_id: job.id });
            if (error) throw error;

            // Immediate re-dispatch via secure dispatcher
            await supabase.functions.invoke('import-extract', {
                body: { job_id: job.id }
            });

            fetchData();
        } catch (e: any) {
            console.error(e);
            setErrorMessage(e.message || "Erro ao tentar novamente.");
        } finally {
            setIsExtracting(false);
        }
    };

    const handleAdvancedOcr = async () => {
        if (!job) return;
        try {
            if (!confirm("O OCR Avançado é um processo mais lento (pode levar 2-3 minutos). Deseja continuar?")) return;

            setUiStatus('extraction_failed_action'); // Mantém UI, mas vou mudar msg via state local se der
            setWarningMessage("Iniciando OCR Avançado... Aguarde.");
            setIsExtracting(true);

            const { data, error } = await supabase.functions.invoke('import-ocr-fallback', {
                body: { job_id: job.id }
            });

            if (error) throw error;

            if (data?.ok) {
                setWarningMessage("OCR Avançado finalizado! Recarregando dados...");
                fetchData();
            } else {
                // SPECIAL HANDLER: Background Processing (Not an error)
                // If the worker decided to run in background (202 Accepted equivalent), it returns ok:false but with a specific message.
                const isBackground =
                    data?.message?.includes("Processamento iniciado em background") ||
                    data?.started_in_background === true;

                if (isBackground) {
                    setWarningMessage("Solicitação enviada. Processamento em segundo plano...");
                    setUiStatus('queued'); // This triggers the polling UI
                    return; // Stop here, do not throw
                }

                throw new Error(data?.message || "O OCR não retornou sucesso.");
            }

        } catch (e: any) {
            console.error(e);

            // DEFENSIVE ERROR HANDLING FOR WORKER LIMIT (546)
            let isWorkerLimit = false;

            try {
                // 1. Check Status Code directly if standard HttpError
                if (e?.status === 546 || e?.context?.response?.status === 546) {
                    isWorkerLimit = true;
                }

                // 2. Check Error Body/Message
                if (!isWorkerLimit) {
                    const msg = JSON.stringify(e || "").toLowerCase();
                    if (msg.includes("worker_limit") || msg.includes("546")) {
                        isWorkerLimit = true;
                    }
                }

                // 3. Deep inspection of Supabase Error context (if available)
                if (!isWorkerLimit && e?.context?.response) {
                    // Try to inspect response body if not already consumed
                    // This is risky if stream is locked, so we wrap in try/catch specifically
                    try {
                        const body = await e.context.response.clone().json();
                        if (body?.code === 'WORKER_LIMIT') {
                            isWorkerLimit = true;
                        }
                    } catch (ignore) { /* Body likely already consumed or not JSON */ }
                }
            } catch (inspectionErr) {
                console.warn("Failed to inspect error details:", inspectionErr);
            }

            if (isWorkerLimit) {
                // SILENCE THE ERROR: Do NOT call setErrorMessage.
                // The UI is already in "Extração Limitada" state, so we just let the user try again or continue manually.
                console.warn("OCR limit reached (546), suppressing UI error.");
                return;
            }

            setErrorMessage(e.message || "Erro no OCR Avançado.");
        } finally {
            setIsExtracting(false);
        }
    };

    // ... download helper ...
    const handleDownloadText = () => {
        if (!file?.extracted_text) return;
        saveAs(new Blob([file.extracted_text], { type: "text/plain;charset=utf-8" }), `${file.original_filename}.txt`);
    };

    // --- RENDER ---
    if (uiStatus === 'loading' && !job) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-blue-600" /></div>;
    if (uiStatus === 'review_ready' && id) return <ImportReviewPage jobId={id} />;

    return (
        <div className="min-h-screen bg-slate-50 p-6 md:p-12">
            <div className="max-w-4xl mx-auto">
                <button onClick={() => navigate('/budgets')} className="flex items-center text-slate-500 hover:text-slate-800 mb-6 transition-colors">
                    <ArrowLeft size={16} className="mr-2" /> Voltar
                </button>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-8 border-b border-slate-100 flex items-start gap-5">
                        <StatusIcon status={uiStatus} />
                        <div className="flex-1">
                            <h1 className="text-2xl font-bold text-slate-900 mb-1">
                                <StatusTitle status={uiStatus} isExtracting={isExtracting} />
                            </h1>
                            <p className="text-slate-500 text-sm">Job: <span className="font-mono bg-slate-100 px-1">{id}</span></p>

                            {['queued', 'ocr_running', 'applying', 'finalizing'].includes(uiStatus) && (
                                <div className="mt-4 w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                                    <div className="h-full bg-blue-600 rounded-full w-1/3 animate-indeterminate-bar"></div>
                                </div>
                            )}
                            {errorMessage && <div className="mt-4 bg-red-50 p-3 rounded text-red-800 text-sm flex gap-2"><AlertCircle size={16} /> {errorMessage}</div>}
                            {warningMessage && <div className="mt-4 bg-amber-50 p-3 rounded text-amber-800 text-sm flex gap-2"><AlertCircle size={16} /> {warningMessage}</div>}
                        </div>
                    </div>

                    <div className="p-8 bg-slate-50/50 min-h-[300px]">
                        {['queued', 'ocr_running', 'applying', 'finalizing'].includes(uiStatus) && (
                            <div className="text-center py-12 text-slate-600">
                                <p>O arquivo está sendo processado. Aguarde...</p>
                                {uiStatus === 'ocr_running' && <div className="text-xs text-slate-400 mt-2 font-mono">OCR Provider Active</div>}
                                {uiStatus === 'applying' && <div className="text-xs text-slate-400 mt-2 font-mono">Applying Results</div>}
                                {uiStatus === 'finalizing' && <div className="text-xs text-slate-400 mt-2 font-mono">Finalizing Budget</div>}
                            </div>
                        )}

                        {['ocr_success', 'ocr_success_with_warn'].includes(uiStatus) && file?.extracted_text && (
                            <div className="space-y-6">
                                <div className="bg-white border border-blue-100 p-6 rounded-xl flex items-center justify-between shadow-sm">
                                    <div>
                                        <h4 className="font-bold text-blue-900 flex items-center gap-2"><Sparkles className="w-4 h-4 text-yellow-500" /> Próximo: Extração IA</h4>
                                        <p className="text-slate-600 text-sm mt-1">{file.extracted_text.length.toLocaleString()} caracteres encontrados.</p>
                                    </div>
                                    <button onClick={handleExtractItems} disabled={isExtracting} className="px-6 py-3 bg-blue-600 text-white rounded-lg font-bold shadow hover:bg-blue-700 flex gap-2 items-center">
                                        {isExtracting ? <Loader2 className="animate-spin" /> : <Sparkles className="w-4 h-4 text-yellow-300" />}
                                        {isExtracting ? 'Processando...' : 'Extrair Itens'}
                                    </button>
                                </div>
                                <div className="border-t pt-4">
                                    <div className="flex justify-between mb-2">
                                        <span className="font-bold text-slate-700">Texto Extraído</span>
                                        <div className="flex gap-2">
                                            <button onClick={() => setShowPreview(!showPreview)} className="text-xs px-2 py-1 border rounded bg-white">Toggle Preview</button>
                                            <button onClick={handleDownloadText} className="text-xs px-2 py-1 border rounded bg-white flex gap-1 items-center"><Download size={12} /> .txt</button>
                                        </div>
                                    </div>
                                    {showPreview && <div className="bg-slate-900 text-slate-300 p-4 rounded text-xs font-mono max-h-64 overflow-auto">{file.extracted_text}</div>}
                                </div>
                            </div>
                        )}

                        {uiStatus === 'retryable' && (
                            <div className="space-y-6">
                                <div className="bg-amber-50 border border-amber-200 p-6 rounded-xl flex items-center justify-between shadow-sm">
                                    <div className="flex-1">
                                        <h4 className="font-bold text-amber-900 flex items-center gap-2">
                                            <AlertCircle className="w-4 h-4" />
                                            IA indisponível no momento
                                        </h4>
                                        <p className="text-amber-800 text-sm mt-1">
                                            {(job as any)?.extraction_next_retry_at
                                                ? `O sistema tentará novamente automaticamente às ${new Date((job as any).extraction_next_retry_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
                                                : "O processamento será retomado em breve."
                                            }
                                        </p>
                                    </div>
                                    <button
                                        onClick={handleRetryExtraction}
                                        disabled={isExtracting}
                                        className="px-6 py-3 bg-amber-600 text-white rounded-lg font-bold shadow hover:bg-amber-700 flex gap-2 items-center transition-all disabled:opacity-50"
                                    >
                                        {isExtracting ? <Loader2 className="animate-spin" size={16} /> : <Sparkles className="w-4 h-4" />}
                                        Tentar agora
                                    </button>
                                </div>

                                <div className="p-4 bg-slate-100 rounded-lg text-xs text-slate-500 font-mono">
                                    Reason: {(job as any)?.extraction_last_reason || 'unknown'} •
                                    Attempt: {(job as any)?.extraction_attempts || 0} / 6
                                </div>
                            </div>
                        )}

                        {uiStatus === 'extraction_failed_action' && (
                            <div className="text-center py-8">
                                <div className="max-w-md mx-auto bg-white p-6 rounded-xl shadow border border-slate-200">
                                    <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                                    <h3 className="text-lg font-bold text-slate-800 mb-2">Atenção: Extração Limitada</h3>
                                    <p className="text-slate-600 mb-6">
                                        {(job as any)?.document_context?.user_action?.message ||
                                            ((job as any)?.status === 'failed' ? "Não foi possível extrair os itens automaticamente (falha no processamento)." :
                                                "O documento não contém itens identificáveis ou está desformatado.")}
                                    </p>

                                    <div className="space-y-3">
                                        <button
                                            onClick={handleAdvancedOcr}
                                            disabled={isExtracting}
                                            className="w-full py-2 bg-blue-50 text-blue-700 font-medium rounded hover:bg-blue-100 border border-blue-200 flex items-center justify-center gap-2"
                                        >
                                            {isExtracting ? <Loader2 className="animate-spin w-4 h-4" /> : null}
                                            Tentar OCR Avançado
                                        </button>
                                        <button
                                            // Se for pra enviar outro PDF, o ideal seria resetar ou reiniciar o processo.
                                            // Por enquanto, apenas recarregamos ou voltamos.
                                            onClick={() => window.location.reload()}
                                            className="w-full py-2 bg-white text-slate-700 font-medium rounded hover:bg-slate-50 border border-slate-200"
                                        >
                                            Enviar outro arquivo
                                        </button>
                                        <div className="relative flex py-2 items-center">
                                            <div className="flex-grow border-t border-gray-200"></div>
                                            <span className="flex-shrink mx-4 text-gray-400 text-xs">OU</span>
                                            <div className="flex-grow border-t border-gray-200"></div>
                                        </div>
                                        <button
                                            // Permite continuar para a tela de revisão mesmo com 0 itens ou itens placeholder
                                            onClick={() => setUiStatus('review_ready')}
                                            className="w-full py-2 bg-blue-600 text-white font-medium rounded hover:bg-blue-700 shadow-sm"
                                        >
                                            Continuar Manualmente
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {['failed', 'ocr_empty', 'unknown_but_renderable'].includes(uiStatus) && uiStatus !== 'extraction_failed_action' && (
                            <div className="text-center py-12">
                                <h3 className="text-lg font-bold text-slate-700 mb-2">{uiStatus === 'failed' ? 'Falha' : 'Status Impreciso'}</h3>
                                {errorMessage && <p className="text-red-500 mb-4">{errorMessage}</p>}
                                <button onClick={() => window.location.reload()} className="px-6 py-2 bg-slate-200 rounded hover:bg-slate-300">Recarregar Página</button>
                            </div>
                        )}
                    </div>
                    {isDebug && <div className="bg-black text-white p-2 text-xs font-mono text-center">DEBUG: {uiStatus} | Build: IMPORTSTATUS_OCR_V1 | Cloudflare Pages</div>}
                </div>
            </div>
        </div>
    )
}

function StatusIcon({ status }: { status: UIStatus }) {
    if (['ocr_success', 'ocr_success_with_warn', 'review_ready'].includes(status)) return <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center"><CheckCircle2 className="w-6 h-6" /></div>;
    if (['loading', 'queued', 'ocr_running', 'extracting', 'applying', 'finalizing'].includes(status)) return <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
    if (status === 'failed') return <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center"><AlertCircle className="w-6 h-6" /></div>;
    if (status === 'extraction_failed_action') return <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center"><AlertCircle className="w-6 h-6" /></div>;
    return <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center"><FileText className="w-6 h-6" /></div>;
}

function StatusTitle({ status, isExtracting }: { status: UIStatus, isExtracting: boolean }) {
    if (isExtracting) return 'Processando Extração...';
    switch (status) {
        case 'review_ready': return 'Importação Concluída';
        case 'ocr_success': case 'ocr_success_with_warn': return 'Leitura Concluída';
        case 'ocr_running': return 'OCR em Andamento';
        case 'retryable': return 'Aguardando Retentativa';
        case 'extraction_failed_action': return 'Atenção Necessária';
        case 'queued': return 'Iniciando...';
        case 'applying': return 'Aplicando resultados no orçamento...';
        case 'finalizing': return 'Finalizando...';
        case 'failed': return 'Falha na Importação';
        default: return 'Verificando Status...';
    }
}
