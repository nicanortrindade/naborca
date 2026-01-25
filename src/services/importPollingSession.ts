
const SESSION_KEY = "naboOrca_import_session_v1";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export interface ImportSession {
    jobId: string;
    importFileId?: string;
    createdAt: number;
    fileName?: string; // Optional: good for UI context
}

export function saveImportSession(session: ImportSession): void {
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) {
        console.error('[ImportSession] Failed to save session', e);
    }
}

export function loadImportSession(): ImportSession | null {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;

        const session = JSON.parse(raw) as ImportSession;

        // Validate Expiration
        if (Date.now() - session.createdAt > SESSION_TIMEOUT_MS) {
            console.log('[ImportSession] Sessão expirada. Limpando.');
            clearImportSession();
            return null;
        }

        return session;
    } catch (e) {
        console.error('[ImportSession] Failed to load session', e);
        clearImportSession(); // Corrupted data
        return null;
    }
}

export function clearImportSession(): void {
    try {
        localStorage.removeItem(SESSION_KEY);
    } catch (e) {
        console.error('[ImportSession] Failed to clear session', e);
    }
}
