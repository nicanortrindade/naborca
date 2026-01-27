
/**
 * DOMAIN GUARD UTILITY
 * 
 * Enforces the canonical domain (naboorca.com) and corrects common typos/misconfigurations.
 * This acts as a client-side safety net against DNS/Deployment misconfigurations.
 */

export const enforceCanonicalDomain = () => {
    // Skip in development to avoid breaking localhost
    if (import.meta.env.DEV) return;

    try {
        const currentHost = window.location.hostname;
        const currentPath = window.location.pathname + window.location.search + window.location.hash;

        // 1. TYPO CORRECTION: "naborca" -> "naboorca"
        // This covers "naborca.com", "naborca.pages.dev", etc.
        // It strictly requires that we are NOT already on "naboorca" (to avoid loops)
        if (currentHost.includes('naborca') && !currentHost.includes('naboorca')) {
            const destination = `https://naboorca.com${currentPath}`;
            console.warn(`[DomainGuard] Redirecting from incorrect host (${currentHost}) to canonical: ${destination}`);
            window.location.replace(destination);
            return;
        }

    } catch (e) {
        console.error("[DomainGuard] Error checking domain:", e);
    }
};
