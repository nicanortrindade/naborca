
import { getCanonicalOrigin } from './appUrl';

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

        const canonical = getCanonicalOrigin(); // https://naboorca.com in PROD
        const canonicalHostname = new URL(canonical).hostname; // naboorca.com

        // Safety: If getCanonicalOrigin returns empty or fails, abort
        if (!canonicalHostname) return;

        // 1. TYPO / WRONG HOST CHECK
        // If we are NOT on the canonical host, redirect.
        // We permit variations if they match exactly logic, but strict match is safer.
        // Exception: Dont fail if currentHost is "www.naboorca.com" and canonical is "naboorca.com"?
        // Let's stick to user request: "naborca" -> "naboorca"

        // Logic: If current host has "naborca" (typo) or ends with "pages.dev" (default), redirect.
        const isWrongHost =
            (currentHost.includes('naborca') && !currentHost.includes('naboorca')) ||
            currentHost.includes('pages.dev');

        if (isWrongHost && currentHost !== canonicalHostname) {
            const destination = `${canonical}${currentPath}`;
            console.warn(`[DomainGuard] Redirecting from incorrect host (${currentHost}) to canonical: ${destination}`);
            window.location.replace(destination);
            return;
        }

    } catch (e) {
        console.error("[DomainGuard] Error checking domain:", e);
    }
};
