
import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2, AlertCircle, CheckCircle2, FileText, ArrowLeft, Download, Sparkles } from 'lucide-react';
import type { ImportJob } from '../features/importer/types';
import ImportReviewPage from './ImportReviewPage';
import { saveAs } from 'file-saver';

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
    | 'unknown_but_renderable';

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

            // B. Fetch Latest File
            const { data: fileData, error: fileError } = await (supabase
                .from('import_files' as any)
                .select('id, job_id, storage_path, original_filename, extracted_text, extracted_json, extracted_completed_at, metadata, created_at')
                .eq('job_id', id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle() as any);

            if (fileError) console.warn("[ImportStatus] Error fetching file:", fileError);

            // C. Derive Status
            const derived = deriveUiStatus(jobData, fileData);

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
        const isFinal = ['ocr_success', 'ocr_success_with_warn', 'ocr_empty', 'review_ready', 'failed'].includes(uiStatus);

        if (isFinal && pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }

        // POKE WORKER if running
        if (uiStatus === 'ocr_running' && id) {
            console.log("Poking worker...");
            supabase.functions.invoke('import-parse-worker', { body: { job_id: id } }).catch(console.error);
        }

    }, [uiStatus, id]);


    // --- 3. STATUS DERIVATION (MATCHING BACKEND LOGIC) ---
    const deriveUiStatus = (j: ImportJob, f: ExtendedImportFile | null): {
        status: UIStatus,
        error?: string,
        warning?: string
    } => {
        const textLen = f?.extracted_text?.length ?? 0;
        const ocr = f?.metadata?.ocr;

        // FINAL-FINAL (itens IA já extraídos, se existir)
        if (f?.extracted_completed_at) {
            return { status: "review_ready" };
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

        // FALLBACK POR JOB
        if (j?.status === "processing") return { status: "queued" };
        if (j?.status === "failed") {
            return { status: "failed", error: j?.last_error || "Falha no processamento" };
        }

        // FALLBACK DE SEGURANÇA (NUNCA LIMBO)
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

            // Invoke Extraction Worker
            const { data, error } = await supabase.functions.invoke('import-extract-worker', {
                body: { job_id: job.id }
            });

            if (error) throw error;
            if (data?.status === 'failed') throw new Error(data.message);

            fetchData();
        } catch (e: any) {
            console.error(e);
            setErrorMessage(e.message || "Erro na extração.");
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

                            {['queued', 'ocr_running'].includes(uiStatus) && (
                                <div className="mt-4 w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                                    <div className="h-full bg-blue-600 rounded-full w-1/3 animate-indeterminate-bar"></div>
                                </div>
                            )}
                            {errorMessage && <div className="mt-4 bg-red-50 p-3 rounded text-red-800 text-sm flex gap-2"><AlertCircle size={16} /> {errorMessage}</div>}
                            {warningMessage && <div className="mt-4 bg-amber-50 p-3 rounded text-amber-800 text-sm flex gap-2"><AlertCircle size={16} /> {warningMessage}</div>}
                        </div>
                    </div>

                    <div className="p-8 bg-slate-50/50 min-h-[300px]">
                        {['queued', 'ocr_running'].includes(uiStatus) && (
                            <div className="text-center py-12 text-slate-600">
                                <p>O arquivo está sendo processado. Aguarde...</p>
                                {uiStatus === 'ocr_running' && <div className="text-xs text-slate-400 mt-2 font-mono">OCR Provider Active</div>}
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

                        {['failed', 'ocr_empty', 'unknown_but_renderable'].includes(uiStatus) && (
                            <div className="text-center py-12">
                                <h3 className="text-lg font-bold text-slate-700 mb-2">{uiStatus === 'failed' ? 'Falha' : 'Status Impreciso'}</h3>
                                {errorMessage && <p className="text-red-500 mb-4">{errorMessage}</p>}
                                <button onClick={() => window.location.reload()} className="px-6 py-2 bg-slate-200 rounded hover:bg-slate-300">Recarregar Página</button>
                            </div>
                        )}
                    </div>
                    {isDebug && <div className="bg-black text-white p-2 text-xs font-mono text-center">DEBUG: {uiStatus} | Build: IMPORTSTATUS_FIX_FINAL | Cloudflare Pages</div>}
                </div>
            </div>
        </div>
    )
}

function StatusIcon({ status }: { status: UIStatus }) {
    if (['ocr_success', 'ocr_success_with_warn', 'review_ready'].includes(status)) return <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center"><CheckCircle2 className="w-6 h-6" /></div>;
    if (['loading', 'queued', 'ocr_running', 'extracting'].includes(status)) return <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
    if (status === 'failed') return <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center"><AlertCircle className="w-6 h-6" /></div>;
    return <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center"><FileText className="w-6 h-6" /></div>;
}

function StatusTitle({ status, isExtracting }: { status: UIStatus, isExtracting: boolean }) {
    if (isExtracting) return 'Processando Extração...';
    switch (status) {
        case 'review_ready': return 'Importação Concluída';
        case 'ocr_success': case 'ocr_success_with_warn': return 'Leitura Concluída';
        case 'ocr_running': return 'OCR em Andamento';
        case 'queued': return 'Iniciando...';
        case 'failed': return 'Falha na Importação';
        default: return 'Verificando Status...';
    }
}
