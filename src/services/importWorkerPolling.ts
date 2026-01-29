
import { supabase } from '../lib/supabase';

export type WorkerStatus = "ocr_started" | "ocr_running" | "success" | "ocr_empty" | "failed" | "timeout" | "unknown";

interface PollingResult {
    finalStatus: WorkerStatus;
    extractedTextLen?: number;
    message?: string;
    raw?: any;
    resultBudgetId?: string;
}

interface WorkerResponse {
    status: string; // response string from worker
    message?: string;
    len?: number;
    error?: string;
    error_message?: string;
    [key: string]: any;
}

/**
 * Minimal Telemetry Helper
 */
function logTelemetry(
    level: 'debug' | 'info' | 'warn' | 'error',
    event: string,
    payload: Record<string, any>
) {
    const isDev = import.meta.env.DEV;
    const msg = `[IMPORT-POLL] ${event}`;

    if (isDev) {
        // Dev: Everything
        if (level === 'error') console.error(msg, payload);
        else if (level === 'warn') console.warn(msg, payload);
        else console.log(msg, payload);
    } else {
        // Prod: Only Info/Warn/Error for key lifecycle events
        // Skip 'polling_attemp' debug spam
        const isKeyLifecycle = ['polling_start', 'polling_terminal', 'polling_cancel'].includes(event);
        const isError = level === 'error' || level === 'warn';

        if (isKeyLifecycle || isError) {
            console.info(JSON.stringify({ event: msg, ...payload }));
        }
    }
}

/**
 * Helper to sleep but reject immediately if signal is aborted.
 */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('Polling cancelled'));

        const timer = setTimeout(() => {
            if (signal?.aborted) {
                reject(new Error('Polling cancelled'));
            } else {
                resolve();
            }
        }, ms);

        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Polling cancelled'));
        });
    });
}

// NEW IMPLEMENTATION: DB Polling
export async function runImportParseWorkerUntilDone(params: {
    jobId: string;
    importFileId?: string;
    signal?: AbortSignal;
    onProgress?: (info: { status: WorkerStatus; attempt: number; nextDelayMs: number; elapsedMs: number; message?: string }) => void;
}): Promise<PollingResult> {
    const { jobId, signal, onProgress } = params;
    const startAt = Date.now();
    let attempt = 0;
    const MAX_TIME_MS = 10 * 60 * 1000; // 10 minutes timeout
    const POLLING_INTERVAL_MS = 3000;

    logTelemetry('info', 'polling_start_db_mode', { jobId });

    while (true) {
        attempt++;
        const elapsedMs = Date.now() - startAt;

        // Check Timeout
        if (elapsedMs > MAX_TIME_MS) {
            logTelemetry('warn', 'polling_terminal', { jobId, reason: 'timeout_duration', elapsedMs });
            return { finalStatus: 'timeout', message: "Tempo limite excedido." };
        }

        // Check Abort
        if (signal?.aborted) {
            logTelemetry('info', 'polling_cancel', { jobId, attempt });
            throw new Error('Polling cancelled');
        }

        try {
            // 1. Fetch Job Status (Fail-fast)
            const { data: jobRaw, error: jobError } = await supabase
                .from('import_jobs' as any)
                .select('status, last_error, result_budget_id')
                .eq('id', jobId)
                .single();

            const job = jobRaw as any;

            // --- CRITICAL FIX: RESULT BUDGET ID TAKES PRECEDENCE OVER ANY STATUS ---
            // If we have a result, WE ARE DONE. Ignore "failed" or any other status.
            if (job?.result_budget_id) {
                logTelemetry('info', 'polling_terminal', { jobId, result: 'success_budget_ready_priority' });
                return {
                    finalStatus: 'success',
                    resultBudgetId: job.result_budget_id,
                    message: "Orçamento gerado com sucesso."
                };
            }

            if (job?.status === 'waiting_user' || job?.status === 'waiting_user_extraction_failed') {
                logTelemetry('info', 'polling_terminal', { jobId, result: 'waiting_user_terminal', status: job.status });
                return {
                    finalStatus: 'success', // Treat as success to navigate to review
                    message: job.status === 'waiting_user_extraction_failed'
                        ? "Extração automática limitada. Redirecionando para manual..."
                        : "Aguardando revisão do usuário."
                };
            }

            if (jobError) {
                // Ignore transient errors, log warning
                console.warn("[IMPORT-POLL] Error fetching job:", jobError);
            } else if (job?.status === 'failed') {
                const msg = job.last_error || "O Job falhou durante o processamento.";
                logTelemetry('error', 'polling_terminal', { jobId, reason: 'job_failed', msg });
                return { finalStatus: 'failed', message: msg };
            }

            // 2. Fetch Tasks Status (Progress)
            const { data: tasks, error: tasksError } = await supabase
                .from('import_parse_tasks' as any)
                .select('status')
                .eq('job_id', jobId);

            if (tasksError) {
                console.warn("[IMPORT-POLL] Error fetching tasks:", tasksError);
            }

            // 3. Fetch Items Count (Feedback)
            const { count: itemsCount, error: itemsError } = await supabase
                .from('import_ai_items' as any)
                .select('*', { count: 'exact', head: true })
                .eq('job_id', jobId);

            // Logic
            if (tasks && tasks.length > 0) {
                const total = tasks.length;
                const done = tasks.filter((t: any) => t.status === 'done').length;
                const failed = tasks.filter((t: any) => t.status === 'failed').length;
                const completed = done + failed;
                const isFinished = completed === total;

                // Progress Update
                if (onProgress) {
                    onProgress({
                        status: 'ocr_running', // Maps to "Processando..." in UI
                        attempt,
                        nextDelayMs: POLLING_INTERVAL_MS,
                        elapsedMs,
                        message: `Processando itens... (${done}/${total}) - ${itemsCount || 0} extraídos`
                    });
                }

                // Check Completion
                if (isFinished) {
                    if (failed === total) {
                        // All failed
                        logTelemetry('error', 'polling_terminal', { jobId, result: 'all_tasks_failed' });
                        return { finalStatus: 'failed', message: "Todas as tarefas de processamento falharam." };
                    }

                    // Success
                    logTelemetry('info', 'polling_terminal', { jobId, result: 'success', items: itemsCount });
                    return {
                        finalStatus: 'success',
                        extractedTextLen: itemsCount || 0, // Abuse field for item count
                        message: `Concluído! ${itemsCount} itens extraídos.`
                    };
                }
            } else {
                // No tasks yet? Maybe just started.
                if (onProgress) {
                    onProgress({
                        status: 'ocr_started',
                        attempt,
                        nextDelayMs: POLLING_INTERVAL_MS,
                        elapsedMs,
                        message: "Iniciando processamento..."
                    });
                }
            }

        } catch (err: any) {
            console.error("[IMPORT-POLL] Unexpected error:", err);
        }

        // Wait
        await sleepAbortable(POLLING_INTERVAL_MS, signal);
    }
}
