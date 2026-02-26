
import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, FileText, Loader2, Sparkles, Play, Trash2, AlertTriangle, HelpCircle, FileCheck, Info, Wand2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { runImportParseWorkerUntilDone } from '../../services/importWorkerPolling';
import { saveImportSession, loadImportSession, clearImportSession, type ImportSession } from '../../services/importPollingSession';
import { clsx } from 'clsx';
import { toRelativePath } from '../../utils/appUrl';

interface AiImporterModalProps {
    onClose: () => void;
}

// Telemetry Helper for UI
function logUiEvent(event: string, payload: Record<string, any>) {
    if (import.meta.env.DEV) {
        console.log(`[UI-IMPORT] ${event}`, payload);
    } else {
        if (['modal_open', 'start_import_click', 'resume_click', 'cancel_click', 'terminal_ui_state'].includes(event)) {
            console.info(JSON.stringify({ event: `[UI-IMPORT] ${event}`, ...payload }));
        }
    }
}

export default function AiImporterModal({ onClose }: AiImporterModalProps) {
    const { user } = useAuth();
    const navigate = useNavigate();

    // UI State: Multi-file Support
    const [syntheticFile, setSyntheticFile] = useState<File | null>(null);
    const [analyticFile, setAnalyticFile] = useState<File | null>(null);

    const [isUploading, setIsUploading] = useState(false);
    const [uploadStep, setUploadStep] = useState<string>('');
    const [cancelMode, setCancelMode] = useState(false);
    const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; percent: number } | undefined>();

    // Session State
    const [resumeSession, setResumeSession] = useState<ImportSession | null>(null);

    // Refs for control
    const pollingControllerRef = useRef<AbortController | null>(null);
    const isRunningRef = useRef(false);

    useEffect(() => {
        logUiEvent('modal_open', { timestamp: Date.now() });
        const session = loadImportSession();
        if (session) {
            setResumeSession(session);
        }
    }, []);

    useEffect(() => {
        return () => {
            if (pollingControllerRef.current) pollingControllerRef.current.abort();
            isRunningRef.current = false;
        };
    }, []);


    // State to track the current active job strictly
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);

    // --- CORE LOGIC: POLLING ENGINE ---
    const executePolling = async (jobId: string, importFileId?: string, fileName?: string) => {
        if (isRunningRef.current) return;

        // Force strictly current ID
        if (currentJobId && currentJobId !== jobId) {
            console.warn('[UI-IMPORT] Polling requested for mismatched Job ID. Ignoring old job.');
            return;
        }

        isRunningRef.current = true;
        const controller = new AbortController();
        pollingControllerRef.current = controller;

        saveImportSession({
            jobId,
            importFileId,
            createdAt: Date.now(),
            fileName: fileName || syntheticFile?.name || 'Projeto'
        });

        try {
            setIsUploading(true);
            setUploadStep('Retomando conexão com Inteligência Artificial...');

            if (controller.signal.aborted) throw new Error('Polling cancelled');

            const result = await runImportParseWorkerUntilDone({
                jobId,
                importFileId,
                signal: controller.signal,
                onProgress: ({ status, attempt, message, batchProgress: bp }) => {
                    if (bp) setBatchProgress(bp);
                    let text = `Processando IA... (Tentativa ${attempt})`;
                    if (status === 'ocr_started') text = 'Iniciando engine OCR...';
                    else if (status === 'ocr_running') text = bp
                        ? `Processando lote ${bp.current} de ${bp.total} (${bp.percent}%)`
                        : `Lendo documentos... (Fase ${attempt})`;
                    else if (status === 'unknown') text = `Processando... (estado ${attempt})`;
                    if (message && typeof message === 'string' && !bp) text += ` - ${message}`;
                    setUploadStep(text);
                }
            });

            logUiEvent('terminal_ui_state', { status: result.finalStatus, jobId });

            if (result.finalStatus === 'success') {
                setUploadStep('Concluído! Aguardando finalização do orçamento...');

                // Auto-finalization flow:
                // 1. Poll until stage = 'extraction_complete' (or already 'finalized')
                // 2. When extraction_complete detected, auto-call import-finalize-budget
                // 3. Then poll until stage = 'finalized' AND result_budget_id is present
                // 4. Redirect to import review/budget page
                let attempts = 0;
                const maxAttempts = 120; // 120 × 3 s = 360 s max wait
                let finalizationTriggered = false;

                const pollBudget = async (): Promise<void> => {
                    if (attempts >= maxAttempts || controller.signal.aborted) {
                        // Timeout safety valve — redirect to review so user is never stuck
                        console.warn('[UI-IMPORT] pollBudget timeout — redirecting as fallback', { jobId, attempts });
                        clearImportSession();
                        navigate(toRelativePath(`/importacoes/${jobId}`));
                        onClose();
                        return;
                    }
                    attempts++;
                    const { data: jobData } = await supabase
                        .from('import_jobs' as any)
                        .select('result_budget_id, stage, status')
                        .eq('id', jobId)
                        .single();

                    const isFinalized = jobData?.stage === 'finalized';
                    const isPendingHydration = jobData?.stage === 'pending_hydration';
                    const isExtractionComplete =
                        jobData?.stage === 'extraction_complete' ||
                        (jobData?.status === 'done' && !jobData?.result_budget_id);
                    const hasBudgetId = !!jobData?.result_budget_id;

                    // Redireciona quando finalizado com budget_id
                    if (isFinalized && hasBudgetId) {
                        clearImportSession();
                        await new Promise(r => setTimeout(r, 600));
                        if (!controller.signal.aborted) {
                            navigate(toRelativePath(`/importacoes/${jobId}`));
                            onClose();
                        }
                        return;
                    }

                    // Mostra progresso enquanto hydration roda
                    if (isPendingHydration && hasBudgetId) {
                        setUploadStep('Vinculando itens às bases de preços...');
                    }

                    // Dispara finalização uma vez quando extração completa
                    if (isExtractionComplete && !finalizationTriggered) {
                        finalizationTriggered = true;
                        setUploadStep('Extração concluída! Gerando orçamento automaticamente...');
                        try {
                            await supabase.functions.invoke('import-finalize-budget', {
                                body: { job_id: jobId }
                            });
                        } catch (finalizeErr) {
                            console.warn('[UI-IMPORT] Auto-finalize call failed, will keep polling', finalizeErr);
                        }
                    }

                    // If finalization was triggered but taking too long, redirect to review
                    if (finalizationTriggered && attempts > 40) {
                        console.warn('[UI-IMPORT] pollBudget: finalization triggered but no result after 120s — redirecting to review');
                        clearImportSession();
                        navigate(toRelativePath(`/importacoes/${jobId}`));
                        onClose();
                        return;
                    }

                    // Update progress text
                    if (isPendingHydration && hasBudgetId) {
                        setUploadStep('Vinculando itens às bases de preços...');
                    } else if (isFinalized && !hasBudgetId) {
                        setUploadStep('Finalizado! Aguardando ID do orçamento...');
                    } else if (finalizationTriggered) {
                        setUploadStep(`Finalizando orçamento... (${attempts})`);
                    } else {
                        setUploadStep(`Aguardando conclusão da extração... (${attempts})`);
                    }

                    await new Promise(r => setTimeout(r, 3000));
                    return pollBudget();
                };
                await pollBudget();
                return;

            } else {
                // FAILURE / THRESHOLD REACHED
                // Instead of throwing, we redirect to review so user can see what happened or do manual entry.
                console.warn('[UI-IMPORT] Polling ended with non-success status. Redirecting to review.', result);
                clearImportSession();

                // Soft Fail -> Review
                navigate(toRelativePath(`/importacoes/${jobId}`));
                onClose();
                return;
            }
        } catch (error: any) {
            if (error.message === 'Polling cancelled' || error.message?.includes('aborted')) {
                setUploadStep('Cancelado.');
                if (isRunningRef.current) setIsUploading(false);
            } else {
                // SOFT FAIL STRATEGY
                console.warn('[UI-IMPORT] Polling exception caught. Redirecting to review...', error);

                // We have a Job ID, so we fail forward.
                clearImportSession();
                navigate(toRelativePath(`/importacoes/${jobId}`));
                onClose();
            }
        } finally {
            isRunningRef.current = false;
            setCancelMode(false);
            // Don't clear currentJobId here to avoid UI flicker, let unmount handle it
        }
    };

    const handleStartNewImport = async () => {
        if (!syntheticFile || !user) return;

        try {
            logUiEvent('start_import_click', { fileName: syntheticFile.name });
            setIsUploading(true);
            setUploadStep('Preparando ambiente...');

            // PATCH OBIGATÓRIO: Limpar qualquer sessão anterior para evitar "Resume" de job antigo
            clearImportSession();
            setResumeSession(null);
            setCurrentJobId(null);

            setUploadStep('Criando job de importação...');

            // 1. Create Job with robust error handling
            const { data: jobData, error: jobError } = await (supabase
                .from('import_jobs' as any)
                .insert({ user_id: user.id, status: 'queued' })
                .select()
                .single() as any);

            if (jobError) throw new Error(jobError.message);

            // Set the Source of Truth immediately
            setCurrentJobId(jobData.id);

            // 2. Upload Files Function
            const uploadFile = async (file: File, role: 'synthetic' | 'analytical') => {
                setUploadStep(`Enviando ${role === 'synthetic' ? 'Sintético' : 'Analítico'}...`);
                const fileExt = file.name.split('.').pop();
                const storagePath = `${user.id}/${Date.now()}_${role}_${Math.random().toString(36).substring(7)}.${fileExt}`;

                const { error: storageError } = await supabase.storage.from('imports').upload(storagePath, file);
                if (storageError) throw new Error(storageError.message);

                const { data: fileData, error: dbError } = await (supabase
                    .from('import_files' as any)
                    .insert({
                        user_id: user.id,
                        job_id: jobData.id,
                        file_kind: 'pdf', // Assuming PDF for OCR flow
                        doc_role: role,
                        original_filename: file.name,
                        content_type: file.type,
                        storage_bucket: 'imports',
                        storage_path: storagePath
                    })
                    .select('id')
                    .single() as any);
                if (dbError) throw new Error(dbError.message);
                return fileData.id;
            };

            // Process both slots
            const synId = await uploadFile(syntheticFile, 'synthetic');
            if (analyticFile) {
                await uploadFile(analyticFile, 'analytical');
            }

            // 2.5 Invoke Edge Function (Explicit Execution)
            setUploadStep('Iniciando processamento inteligente...');
            const { error: invokeError } = await supabase.functions.invoke('import-processor', {
                body: { job_id: jobData.id }
            });

            if (invokeError) {
                console.error("[UI] Failed to invoke import-processor:", invokeError);
                throw new Error("Falha ao iniciar processamento. Tente novamente.");
            }

            // 3. Start Polling with strict ID
            await executePolling(jobData.id, synId, syntheticFile.name);

        } catch (error: any) {
            // SOFT FAIL STRATEGY:
            // If we have a Job ID, we must recover to the Review Page regardless of the error.
            const targetJobId = currentJobId;

            if (targetJobId) {
                console.warn("[UI-IMPORT] Recoverable error caught. Redirecting to review...", error);

                // Ensure session is cleared so we don't resume a broken loop
                clearImportSession();

                // Redirect user to manage the job manually
                navigate(toRelativePath(`/importacoes/${targetJobId}`));
                onClose();
            } else {
                // Fatal error (DB insert failed, no Job ID)
                console.error('Falha fatal na importação:', error);
                alert(error.message || 'Ocorreu um erro ao criar o job de importação.');
                setIsUploading(false);
                setCurrentJobId(null);
            }
        }
    };

    const FileSlot = ({ label, file, setFile, required }: { label: string, file: File | null, setFile: (f: File | null) => void, required?: boolean }) => (
        <div className={clsx(
            "relative border-2 border-dashed rounded-2xl p-6 transition-all group",
            file ? "border-green-500 bg-green-50/30" : "border-slate-200 hover:border-blue-400 bg-slate-50/50"
        )}>
            <input
                type="file"
                accept=".pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="flex items-center gap-4">
                <div className={clsx(
                    "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                    file ? "bg-green-600 text-white" : "bg-white text-slate-400 border border-slate-200 group-hover:bg-blue-600 group-hover:text-white"
                )}>
                    {file ? <FileCheck size={20} /> : <Upload size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label} {required && <span className="text-red-500">*</span>}</p>
                    <p className={clsx("text-sm font-bold truncate", file ? "text-green-700" : "text-slate-600")}>
                        {file ? file.name : "Clique ou arraste o arquivo"}
                    </p>
                </div>
                {file && (
                    <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="p-2 hover:bg-red-50 text-red-400 rounded-lg relative z-20">
                        <X size={16} />
                    </button>
                )}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100 ring-1 ring-black/5">
                {/* Header */}
                <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-8 text-white relative">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Sparkles size={80} />
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                        <Sparkles className="w-5 h-5 text-yellow-300 animate-pulse" />
                        <h2 className="text-2xl font-black tracking-tight">Importação com IA</h2>
                    </div>
                    <p className="text-blue-100/80 text-sm font-medium">Fase 3: Extração Sintética e Hidratação Analítica</p>
                    {!isUploading && (
                        <button onClick={onClose} className="absolute top-6 right-6 p-2 hover:bg-white/10 rounded-full transition-colors"><X size={20} /></button>
                    )}
                </div>

                {/* Body */}
                <div className="p-8 space-y-6">
                    {!isUploading ? (
                        resumeSession ? (
                            <div className="bg-blue-50/50 border border-blue-100 rounded-3xl p-6 space-y-4">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-blue-600/20"><Play size={24} /></div>
                                    <div>
                                        <h3 className="font-black text-slate-800 text-lg leading-tight">Retomar Sessão</h3>
                                        <p className="text-sm text-slate-600 mt-1">Existe um processamento pendente: <span className="font-bold">{resumeSession.fileName}</span></p>
                                    </div>
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button onClick={() => { clearImportSession(); setResumeSession(null); }} className="flex-1 py-3 px-4 border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 text-sm font-bold transition-all">Descartar</button>
                                    <button onClick={() => executePolling(resumeSession.jobId, resumeSession.importFileId, resumeSession.fileName)} className="flex-[2] py-3 px-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-bold shadow-lg shadow-blue-600/25">Continuar</button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="space-y-3">
                                    <FileSlot label="Planilha Sintética" file={syntheticFile} setFile={setSyntheticFile} required />
                                    <FileSlot label="Planilha Analítica (Opcional)" file={analyticFile} setFile={setAnalyticFile} />
                                </div>

                                <div className="bg-indigo-50/50 border border-indigo-100 p-4 rounded-2xl flex gap-3">
                                    <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-xs font-bold text-indigo-900 leading-normal">Como funciona?</p>
                                        <p className="text-xs text-indigo-700 mt-1 leading-relaxed">
                                            A IA extrai a estrutura da planilha <strong>Sintética</strong> e usa a <strong>Analítica</strong> para encontrar as composições que não existem na base oficial.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button onClick={onClose} className="flex-1 py-3 text-slate-400 hover:text-slate-600 font-bold transition-colors">Cancelar</button>
                                    <button
                                        onClick={handleStartNewImport}
                                        disabled={!syntheticFile}
                                        className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black hover:bg-blue-700 shadow-xl shadow-blue-600/20 disabled:opacity-50 disabled:shadow-none transition-all flex items-center justify-center gap-2"
                                    >
                                        <Wand2 size={18} /> INICIAR IMPORTAÇÃO
                                    </button>
                                </div>
                            </>
                        )
                    ) : (
                        <div className="py-12 flex flex-col items-center text-center space-y-6">
                            <div className="relative">
                                <div className="absolute inset-0 bg-blue-500/20 blur-2xl rounded-full animate-pulse"></div>
                                <Loader2 className="w-16 h-16 text-blue-600 animate-spin relative z-10" />
                            </div>
                            <div className="space-y-4 w-full max-w-sm">
                                <h3 className="text-xl font-black text-slate-800">Processando Inteligência Artificial</h3>
                                {batchProgress ? (
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs font-medium text-slate-500">
                                            <span>Lote {batchProgress.current} de {batchProgress.total}</span>
                                            <span>{batchProgress.percent}%</span>
                                        </div>
                                        <div className="w-full bg-slate-200 rounded-full h-2">
                                            <div
                                                className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                                                style={{ width: `${batchProgress.percent}%` }}
                                            />
                                        </div>
                                        <p className="text-sm font-medium text-slate-400">{uploadStep}</p>
                                    </div>
                                ) : (
                                    <p className="text-sm font-medium text-slate-400 animate-pulse">{uploadStep}</p>
                                )}
                            </div>
                            <button onClick={() => setCancelMode(true)} className="text-xs font-bold text-slate-300 hover:text-red-500 transition-colors">Interromper processo</button>
                        </div>
                    )}
                </div>
            </div>

            {/* Cancel Modal Overlay */}
            {cancelMode && (
                <div className="fixed inset-0 bg-white/80 backdrop-blur-md z-[60] flex items-center justify-center p-6">
                    <div className="max-w-sm w-full space-y-6 text-center">
                        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto"><AlertTriangle size={32} /></div>
                        <h4 className="text-2xl font-black text-slate-800">Cancelar Importação?</h4>
                        <p className="text-slate-500 text-sm">O processamento pode ser continuado depois se você escolher "Manter".</p>
                        <div className="flex flex-col gap-2">
                            <button onClick={() => { setCancelMode(false); }} className="w-full py-4 text-slate-400 font-bold hover:text-slate-600 transition-colors">Voltar</button>
                            <button onClick={() => { if (pollingControllerRef.current) pollingControllerRef.current.abort(); setIsUploading(false); onClose(); }} className="w-full py-4 bg-slate-100 text-slate-700 rounded-2xl font-black hover:bg-slate-200 transition-colors">Manter em 2º Plano</button>
                            <button onClick={() => { clearImportSession(); if (pollingControllerRef.current) pollingControllerRef.current.abort(); setIsUploading(false); onClose(); }} className="w-full py-4 bg-red-600 text-white rounded-2xl font-black hover:bg-red-700 shadow-xl shadow-red-600/20 transition-colors">Descartar Totalmente</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
