const PLACEHOLDER = 'https://placeholder.invalid';

/**
 * Restrict a user-supplied return target to a same-origin pathname.
 * Rejects absolute URLs, protocol-relative paths, backslash-prefixed paths, CRLF
 * header-injection attempts, dot-segment traversal, URL-encoded bypasses, and
 * oversized inputs. Returns the input on success, '/' on rejection.
 */
export function sanitizeReturnPathname(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '/';
  if (input.length > 2048) return '/';
  if (!input.startsWith('/')) return '/';
  if (input.startsWith('//')) return '/';
  if (input.startsWith('/\\')) return '/';
  if (/[\r\n]/.test(input)) return '/';

  try {
    const u = new URL(input, PLACEHOLDER);
    if (u.origin !== PLACEHOLDER) return '/';
    const normalized = u.pathname + u.search + u.hash;
    if (normalized !== input) return '/';
    const decoded = decodeURIComponent(u.pathname);
    if (decoded.startsWith('//') || decoded.startsWith('/\\')) return '/';
  } catch {
    return '/';
  }
  return input;
}
