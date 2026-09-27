/**
 * Runs before first paint so a dark-mode user never sees a white flash, and
 * keeps public pages static (no cookie read on the server). The theme only
 * styles the signed-in app (.app-shell), not the public site.
 *
 * The Content-Security-Policy (src/proxy.ts) allows exactly this script by its
 * hash, so it runs without a nonce; changing the text changes the hash too.
 */
export const THEME_SCRIPT = `document.documentElement.dataset.theme=/(?:^|; )cmd_theme=dark/.test(document.cookie)?"dark":"light"`;
