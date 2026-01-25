
import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, FileText, Loader2, Sparkles, Play, Trash2, AlertTriangle, HelpCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { runImportParseWorkerUntilDone } from '../../services/importWorkerPolling';
import { saveImportSession, loadImportSession, clearImportSession, type ImportSession } from '../../services/importPollingSession';

interface AiImporterModalProps {
    onClose: () => void;
}

// Telemetry Helper for UI
function logUiEvent(event: string, payload: Record<string, any>) {
    if (import.meta.env.DEV) {
        console.log(`[UI-IMPORT] ${event}`, payload);
    } else {
        // Prod: Log only critical UI flows
        if (['modal_open', 'start_import_click', 'resume_click', 'cancel_click', 'terminal_ui_state'].includes(event)) {
            console.info(JSON.stringify({ event: `[UI-IMPORT] ${event}`, ...payload }));
        }
    }
}

export default function AiImporterModal({ onClose }: AiImporterModalProps) {
    const { user } = useAuth();
    const navigate = useNavigate();

    // UI State
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStep, setUploadStep] = useState<string>('');
    const [cancelMode, setCancelMode] = useState(false);

    // Session State
    const [resumeSession, setResumeSession] = useState<ImportSession | null>(null);

    // Refs for control
    const pollingControllerRef = useRef<AbortController | null>(null);
    const isRunningRef = useRef(false);

    // 1. Check for valid session on mount
    useEffect(() => {
        logUiEvent('modal_open', { timestamp: Date.now() });
        const session = loadImportSession();
        if (session) {
            console.log('[AiImporter] Found valid session:', session.jobId);
            setResumeSession(session);
            logUiEvent('session_found', { jobId: session.jobId });
        }
    }, []);

    // 2. Unmount Cleanup
    useEffect(() => {
        return () => {
            if (pollingControllerRef.current) {
                console.log('[AiImporter] Unmounting - aborting polling');
                pollingControllerRef.current.abort();
            }
            isRunningRef.current = false;
        };
    }, []);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    // --- CORE LOGIC: POLLING ENGINE ---
    const executePolling = async (jobId: string, importFileId?: string, fileName?: string) => {
        if (isRunningRef.current) return;

        isRunningRef.current = true;
        const controller = new AbortController();
        pollingControllerRef.current = controller;

        // Save session (Refresh safety)
        saveImportSession({
            jobId,
            importFileId,
            createdAt: Date.now(),
            fileName: fileName || file?.name || 'Arquivo Recuperado'
        });

        try {
            setIsUploading(true);
            setUploadStep('Retomando conexão com Inteligência Artificial...');

            if (controller.signal.aborted) throw new Error('Polling cancelled');

            const result = await runImportParseWorkerUntilDone({
                jobId,
                importFileId,
                signal: controller.signal,
                onProgress: ({ status, attempt, message }) => {
                    let text = `Processando IA... (Tentativa ${attempt})`;
                    if (status === 'ocr_started') text = 'Iniciando engine OCR...';
                    else if (status === 'ocr_running') text = `Lendo documento... (Passo ${attempt})`;
                    else if (status === 'unknown') text = `Processando... (estado interno ${attempt})`;
                    if (message && typeof message === 'string') text += ` - ${message}`;
                    setUploadStep(text);
                }
            });

            logUiEvent('terminal_ui_state', { status: result.finalStatus, jobId });

            if (result.finalStatus === 'success') {
                setUploadStep('Concluído! Redirecionando...');
                clearImportSession();
                await new Promise(r => setTimeout(r, 800));
                if (!controller.signal.aborted) {
                    navigate(`/importacoes/${jobId}`);
                    onClose();
                }
            } else if (result.finalStatus === 'ocr_empty') {
                setIsUploading(false);
                setUploadStep('');
                clearImportSession();
                alert('O documento foi processado, mas nenhum texto foi encontrado.\nVerifique se o PDF contém texto selecionável ou imagens legíveis.');
            } else if (result.finalStatus === 'timeout') {
                setIsUploading(false);
                setUploadStep('');
                alert('O processamento demorou mais que o esperado (timeout). Você pode tentar retomar a operação.');
                setResumeSession(loadImportSession());
            } else {
                // Failed
                clearImportSession();
                throw new Error(result.message || 'Falha no processamento do arquivo.');
            }

        } catch (error: any) {
            if (error.message === 'Polling cancelled' || error.message?.includes('aborted')) {
                console.log('Import cancelled correctly');
                setUploadStep('Cancelado.');
            } else {
                console.error('Falha na importação:', error);
                logUiEvent('import_error_ui', { message: error.message });
                if (isRunningRef.current) {
                    alert(error.message || 'Ocorreu um erro desconhecido.');
                }
            }
            if (isRunningRef.current) setIsUploading(false);
        } finally {
            if (pollingControllerRef.current === controller) pollingControllerRef.current = null;
            isRunningRef.current = false;
            setCancelMode(false);
        }
    };

    // --- ACTIONS ---

    const handleStartNewImport = async () => {
        if (!file || !user) return;

        try {
            logUiEvent('start_import_click', { fileName: file.name, fileSize: file.size });
            setIsUploading(true);
            setUploadStep('Criando job de importação...');

            // 1. Create Job/File
            const { data: jobData, error: jobError } = await (supabase
                .from('import_jobs' as any)
                .insert({ user_id: user.id, status: 'queued' })
                .select()
                .single() as any);
            if (jobError) throw new Error(`Erro ao criar job: ${jobError.message}`);

            setUploadStep('Enviando arquivo para análise...');
            const fileExt = file.name.split('.').pop();
            const storagePath = `${user.id}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

            const { error: storageError } = await supabase.storage.from('imports').upload(storagePath, file);
            if (storageError) throw new Error(`Erro no upload: ${storageError.message}`);

            setUploadStep('Registrando metadados...');
            const { data: fileData, error: fileDbError } = await (supabase
                .from('import_files' as any)
                .insert({
                    user_id: user.id,
                    job_id: jobData.id,
                    file_kind: file.type === 'application/pdf' ? 'pdf' : 'excel',
                    original_filename: file.name,
                    content_type: file.type,
                    storage_bucket: 'imports',
                    storage_path: storagePath
                })
                .select('id')
                .single() as any);
            if (fileDbError) throw new Error(`Erro ao registrar arquivo: ${fileDbError.message}`);

            // 2. Start Polling
            await executePolling(jobData.id, fileData?.id, file.name);

        } catch (error: any) {
            console.error('Falha no upload:', error);
            alert(error.message);
            setIsUploading(false);
        }
    };

    const handleResume = () => {
        if (!resumeSession) return;
        logUiEvent('resume_click', { jobId: resumeSession.jobId });
        executePolling(resumeSession.jobId, resumeSession.importFileId, resumeSession.fileName);
    };

    const handleDiscardSession = () => {
        if (!confirm('Tem certeza que deseja descartar esta importação pendente?')) return;
        logUiEvent('discard_click', { jobId: resumeSession?.jobId });
        clearImportSession();
        setResumeSession(null);
    };

    // --- CANCELLATION FLOW ---

    const handleRequestCancel = () => {
        setCancelMode(true);
        logUiEvent('cancel_request', {});
    };

    const confirmCancel = (discard: boolean) => {
        logUiEvent('cancel_confirm', { discard });
        if (pollingControllerRef.current) {
            pollingControllerRef.current.abort();
            pollingControllerRef.current = null;
        }

        if (discard) {
            clearImportSession();
            setResumeSession(null);
        }

        setIsUploading(false);
        setUploadStep('');
        onClose();
    };

    const resumeCancel = () => {
        setCancelMode(false);
    };


    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-6 text-white flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Sparkles className="w-5 h-5 text-yellow-300 animate-pulse" />
                            <h2 className="text-xl font-bold">Importação com IA</h2>
                            <span className="bg-white/20 text-white text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">Beta</span>
                        </div>
                        <p className="text-white/80 text-sm mt-1">
                            {!isUploading
                                ? "Carregue seu orçamento (PDF) para leitura automática."
                                : "Processando seu documento nas nuvens..."}
                        </p>
                    </div>
                    {!isUploading && (
                        <button
                            onClick={onClose}
                            className="text-white/70 hover:text-white p-1 hover:bg-white/10 rounded transition-colors"
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">
                    {!isUploading ? (
                        <>
                            {/* CASE: FOUND EXISTING SESSION */}
                            {resumeSession ? (
                                <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
                                    <div className="flex items-start gap-3">
                                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                                            <AlertTriangle className="text-blue-600 w-5 h-5" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-slate-800">Importação em Andamento</h3>
                                            <p className="text-sm text-slate-600 mt-1">
                                                Encontramos uma importação anterior ({resumeSession.fileName || 'Sem nome'}) iniciada há {Math.round((Date.now() - resumeSession.createdAt) / 60000)} minutos.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-3 pt-2">
                                        <button
                                            onClick={handleDiscardSession}
                                            className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                                        >
                                            <Trash2 size={16} />
                                            Descartar
                                        </button>
                                        <button
                                            onClick={handleResume}
                                            className="flex-[2] py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
                                        >
                                            <Play size={16} />
                                            Retomar Importação
                                        </button>
                                    </div>
                                    <div className="text-center">
                                        <button onClick={() => setResumeSession(null)} className="text-xs text-slate-400 hover:text-slate-600 underline">
                                            Ignorar e iniciar nova importação
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {/* CASE: STANDARD UPLOAD */}
                                    <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 bg-slate-50 hover:bg-slate-100 transition-colors text-center group cursor-pointer relative">
                                        <input
                                            type="file"
                                            accept=".pdf,.xlsx,.xls"
                                            onChange={handleFileChange}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform">
                                                <Upload size={24} />
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-sm font-medium text-slate-700">
                                                    Clique ou arraste seu arquivo aqui
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    Suporta PDF e Excel (XLSX)
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {file && (
                                        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-center gap-3">
                                            <FileText className="text-blue-600 w-5 h-5" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-blue-900 truncate">
                                                    {file.name}
                                                </p>
                                                <p className="text-xs text-blue-600">
                                                    {(file.size / 1024 / 1024).toFixed(2)} MB
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => setFile(null)}
                                                className="text-blue-400 hover:text-blue-700 p-1"
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                    )}

                                    <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-4">
                                        <p className="text-xs text-yellow-800 leading-relaxed flex gap-2">
                                            <HelpCircle className="w-4 h-4 shrink-0" />
                                            <span>
                                                <strong>Nota:</strong> A IA tentará identificar códigos SINAPI/ORSE, descrições e preços.
                                                Você poderá revisar tudo antes de criar o orçamento final.
                                            </span>
                                        </p>
                                    </div>

                                    <div className="flex justify-end gap-3 pt-2">
                                        <button
                                            onClick={onClose}
                                            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium text-sm transition-colors"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            onClick={handleStartNewImport}
                                            disabled={!file}
                                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors shadow-lg shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {file ? 'Iniciar Leitura com IA' : 'Selecione um arquivo'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </>
                    ) : (
                        /* CASE: UPLOADING / POLLING */
                        <div className="py-8 flex flex-col items-center justify-center text-center space-y-6">

                            {!cancelMode ? (
                                <>
                                    <div className="relative">
                                        <div className="absolute inset-0 bg-blue-500 blur-xl opacity-20 rounded-full animate-pulse"></div>
                                        <Loader2 className="w-16 h-16 text-blue-600 animate-spin relative z-10" />
                                    </div>
                                    <div className="max-w-xs mx-auto">
                                        <h3 className="text-lg font-semibold text-slate-800 mb-2">Processando...</h3>
                                        <p className="text-sm text-slate-500 animate-pulse">{uploadStep}</p>
                                    </div>

                                    <button
                                        onClick={handleRequestCancel}
                                        className="text-xs text-slate-400 hover:text-red-600 hover:underline transition-colors mt-4"
                                    >
                                        Interromper processo
                                    </button>
                                </>
                            ) : (
                                /* CASE: CONFIRM CANCEL */
                                <div className="w-full bg-red-50 border border-red-100 rounded-xl p-6 animate-in zoom-in-95 duration-200">
                                    <h4 className="font-bold text-red-800 text-lg mb-2">Interromper Importação?</h4>
                                    <p className="text-sm text-red-700 mb-6">
                                        O processo ainda está rodando no servidor. O que você deseja fazer?
                                    </p>

                                    <div className="flex flex-col gap-3">
                                        <button
                                            onClick={() => confirmCancel(false)}
                                            className="w-full py-2 px-4 bg-white border border-red-200 text-red-700 rounded-lg font-medium hover:bg-red-50 transition-colors text-sm"
                                        >
                                            Fechar e continuar rodando em 2º plano
                                            <span className="block text-[10px] text-red-500 font-normal">(Você poderá retomar depois)</span>
                                        </button>

                                        <button
                                            onClick={() => confirmCancel(true)}
                                            className="w-full py-2 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors text-sm"
                                        >
                                            Descartar totalmente
                                            <span className="block text-[10px] text-white/80 font-normal">(Perder progresso atual)</span>
                                        </button>

                                        <button
                                            onClick={resumeCancel}
                                            className="w-full py-2 px-4 text-slate-500 hover:text-slate-700 text-sm mt-2"
                                        >
                                            Voltar (Não cancelar)
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
