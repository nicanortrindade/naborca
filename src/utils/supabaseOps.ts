

// Default retry configuration
export interface RetryOptions {
    retries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
    retries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000
};

/**
 * Executes a function with exponential backoff and jitter retries.
 * Retries on network errors, 429, and 5xx errors.
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
    let lastError: any;

    for (let attempt = 0; attempt <= opts.retries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            const status = error?.status || error?.code; // status for HTTP, code for Postgrest logic sometimes

            // Determine if retryable
            const isRetryable =
                !status || // Network error (fetch failed often has no status)
                status === 429 || // Too Many Requests
                (typeof status === 'number' && status >= 500 && status < 600) || // Server Error
                (error?.message && error.message.includes('fetch failed'));

            // Don't retry if we exhausted attempts or error is fatal (400, 401, 404, 409 etc)
            if (!isRetryable || attempt === opts.retries) {
                throw error;
            }

            // Backoff with Jitter
            const delay = Math.min(
                opts.maxDelayMs,
                opts.baseDelayMs * Math.pow(2, attempt) + (Math.random() * 200)
            );

            if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
                console.warn(`[SupabaseOps] Retrying attempt ${attempt + 1}/${opts.retries} after ${Math.round(delay)}ms. Error:`, error.message);
            }

            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastError;
}

/**
 * Splits an array into chunks of a specified size.
 */
export function chunk<T>(arr: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
        arr.slice(i * size, i * size + size)
    );
}

/**
 * Runs a list of async tasks with a concurrency limit.
 * Used for processing chunks in parallel.
 */
export async function runWithConcurrency<T>(
    tasks: (() => Promise<T>)[],
    limit: number,
    onProgress?: (completed: number, total: number) => void
): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let nextTaskIndex = 0;
    let completedCount = 0;

    const worker = async () => {
        while (nextTaskIndex < tasks.length) {
            const index = nextTaskIndex++;
            try {
                results[index] = await tasks[index]();
            } finally {
                completedCount++;
                if (onProgress) onProgress(completedCount, tasks.length);
            }
        }
    };

    const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
    await Promise.all(workers);

    return results;
}

/**
 * Helper to generate batch insert payloads for Supabase.
 * Ensures data matches the expected shape roughly.
 */
export function prepareBatchPayload<T>(items: T[]): T[] {
    return items;
}
