
import { supabase } from '../lib/supabase';

export type WorkerStatus = "ocr_started" | "ocr_running" | "success" | "ocr_empty" | "failed" | "timeout" | "unknown";

interface PollingResult {
    finalStatus: WorkerStatus;
    extractedTextLen?: number;
    message?: string;
    raw?: any;
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

export async function runImportParseWorkerUntilDone(params: {
    jobId: string;
    importFileId?: string;
    signal?: AbortSignal;
    onProgress?: (info: { status: WorkerStatus; attempt: number; nextDelayMs: number; elapsedMs: number; message?: string }) => void;
}): Promise<PollingResult> {
    const { jobId, importFileId, signal, onProgress } = params;
    const startAt = Date.now();
    let attempt = 0;

    // Backoff settings
    let delayMs = 5000;
    const MAX_DELAY = 20000;
    const MAX_ATTEMPTS = 60;
    const MAX_TIME_MS = 10 * 60 * 1000; // 10 minutes

    let lastResponse: WorkerResponse | null = null;
    let consecutiveErrors = 0;
    let unknownCounter = 0;

    logTelemetry('info', 'polling_start', { jobId, importFileId });

    while (attempt < MAX_ATTEMPTS) {
        attempt++;
        const elapsedMs = Date.now() - startAt;

        // Check Timeout
        if (elapsedMs > MAX_TIME_MS) {
            logTelemetry('warn', 'polling_terminal', { jobId, reason: 'timeout_duration', elapsedMs });
            return { finalStatus: 'timeout', raw: lastResponse, message: "Tempo limite excedido." };
        }

        // Check User Abort
        if (signal?.aborted) {
            logTelemetry('info', 'polling_cancel', { jobId, attempt });
            throw new Error('Polling cancelled');
        }

        // Debug log (Dev only)
        logTelemetry('debug', 'polling_attempt', { jobId, attempt, elapsedMs });

        try {
            // Invoke Worker
            const { data, error } = await supabase.functions.invoke('import-parse-worker', {
                body: { job_id: jobId, import_file_id: importFileId }
            });

            if (error) {
                const status = (error as any)?.status || (error as any)?.context?.status || 0;
                const isRateLimit = status === 429;
                const isServerErr = status >= 500 && status < 600;
                const isNetwork = !status;

                logTelemetry('warn', 'polling_http_error', { jobId, attempt, status, message: error.message });

                // Retry Logic
                if (isRateLimit || isServerErr || isNetwork) {
                    consecutiveErrors++;
                    if (consecutiveErrors >= 8) {
                        const msg = `Erro de conexão persistente (${consecutiveErrors} falhas seguidas). Status: ${status}`;
                        logTelemetry('error', 'polling_terminal', { jobId, reason: 'max_consecutive_errors', msg });
                        return { finalStatus: 'failed', message: msg, raw: error };
                    }
                } else {
                    // Client Error
                    const msg = `Erro na requisição: ${error.message || status}`;
                    logTelemetry('error', 'polling_terminal', { jobId, reason: 'client_error', msg });
                    return { finalStatus: 'failed', message: msg, raw: error };
                }
            } else {
                consecutiveErrors = 0;
                lastResponse = data as WorkerResponse;
                const statusRaw = lastResponse.status;
                const message = lastResponse.message;

                // Map raw status to WorkerStatus
                let status: WorkerStatus = 'unknown';

                if (statusRaw === 'success') status = 'success';
                else if (statusRaw === 'ocr_empty') status = 'ocr_empty';
                else if (statusRaw === 'failed' || statusRaw === 'error' || statusRaw === 'ocr_error') status = 'failed';
                else if (statusRaw === 'ocr_started') status = 'ocr_started';
                else if (statusRaw === 'ocr_running') status = 'ocr_running';

                // Handle Unknown
                if (status === 'unknown') {
                    unknownCounter++;
                    logTelemetry('warn', 'polling_unknown_status', { jobId, statusRaw, count: unknownCounter });
                    if (unknownCounter >= 3) {
                        const msg = `Status inesperado do worker: ${statusRaw}`;
                        logTelemetry('error', 'polling_terminal', { jobId, reason: 'max_unknown_status', msg });
                        return { finalStatus: 'failed', message: msg, raw: lastResponse };
                    }
                } else {
                    unknownCounter = 0;
                }

                // Terminal States
                if (status === 'success') {
                    logTelemetry('info', 'polling_terminal', { jobId, finalStatus: 'success', len: lastResponse.len, elapsedMs });
                    return { finalStatus: 'success', extractedTextLen: lastResponse.len, message, raw: lastResponse };
                }
                if (status === 'ocr_empty') {
                    logTelemetry('info', 'polling_terminal', { jobId, finalStatus: 'ocr_empty', elapsedMs });
                    return { finalStatus: 'ocr_empty', message, raw: lastResponse };
                }
                if (status === 'failed') {
                    const fallbackMsg = lastResponse.error_message || lastResponse.error || message || "Erro desconhecido no worker";
                    logTelemetry('error', 'polling_terminal', { jobId, finalStatus: 'failed', msg: fallbackMsg, elapsedMs });
                    return { finalStatus: 'failed', message: fallbackMsg, raw: lastResponse };
                }

                // Report Progress
                if (onProgress) {
                    onProgress({
                        status,
                        attempt,
                        nextDelayMs: delayMs,
                        elapsedMs,
                        message
                    });
                }
            }

        } catch (e: any) {
            if (e.message === 'Polling cancelled') {
                logTelemetry('info', 'polling_cancel', { jobId, attempt });
                throw e;
            }

            console.error(`[IMPORT-POLL] Unexpected exception:`, e);
            consecutiveErrors++;

            if (consecutiveErrors >= 8) {
                const msg = `Exceção crítica no polling: ${e.message}`;
                logTelemetry('error', 'polling_terminal', { jobId, reason: 'exception_loop', msg });
                return { finalStatus: 'failed', message: msg, raw: e };
            }
        }

        // Apply Backoff + Jitter
        const jitter = 0.9 + Math.random() * 0.2;
        const sleepTime = Math.round(delayMs * jitter);

        await sleepAbortable(sleepTime, signal);

        // Increase delay for next time (cap at MAX_DELAY)
        delayMs = Math.min(MAX_DELAY, Math.round(delayMs * 1.35));
    }

    logTelemetry('warn', 'polling_terminal', { jobId, reason: 'max_attempts' });
    return { finalStatus: 'timeout', raw: lastResponse, message: "Número máximo de tentativas excedido." };
}
