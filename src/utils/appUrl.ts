/**
 * Centralized URL handling to prevent wrong-domain issues.
 * This ensures we always favor relative paths for navigation and correct canonical domain for sharing.
 */

const CANONICAL_HOST = 'naboorca.com';
const CANONICAL_PROTOCOL = 'https:';

/**
 * Returns the Canonical Origin (https://naboorca.com) in production,
 * or the current origin in development.
 */
export function getCanonicalOrigin(): string {
    if (typeof window === 'undefined') return ''; // SSR safety

    // In dev, trust the browser (localhost)
    if (import.meta.env.DEV) return window.location.origin;

    // In PROD, Force https://naboorca.com to avoid naborca.pages.dev or others
    return `${CANONICAL_PROTOCOL}//${CANONICAL_HOST}`;
}

/**
 * Converts a path to a full absolute URL using the Canonical Origin.
 * Use this for "Copy Link" or external sharing features.
 */
export function toAbsoluteUrl(path: string): string {
    const origin = getCanonicalOrigin();
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${origin}${cleanPath}`;
}

/**
 * Strips domain/protocol from a URL to ensure it is relative.
 * Useful for internal navigate() calls to prevent accidental domain switching.
 * Example: https://naborca.com/budget/123 -> /budget/123
 */
export function toRelativePath(urlOrPath: string): string {
    if (!urlOrPath) return '/';

    // If it's pure path, return it (ensure slash)
    if (!urlOrPath.startsWith('http') && !urlOrPath.startsWith('//')) {
        return urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
    }

    try {
        const url = new URL(urlOrPath);
        return url.pathname + url.search + url.hash;
    } catch (e) {
        console.warn('[appUrl] Failed to parse URL, forcing path mode:', urlOrPath);
        // Fallback: Strip everything before first slash? 
        // Or just return / if invalid?
        return '/';
    }
}
