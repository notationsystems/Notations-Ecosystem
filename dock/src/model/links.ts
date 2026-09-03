/**
 * Turning snapshot content into links.
 *
 * Node metadata is written by whoever registered the node, so it is attacker-influenced
 * text. React escapes it when rendered, but a link is different: the value becomes part
 * of a destination. Only values that exactly match a known shape are linked; everything
 * else renders as plain text, so no metadata value can steer where a click goes.
 */

const GITHUB_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

/** The GitHub URL for an `owner/repo` value, or null if it is not exactly that. */
export function githubRepoUrl(value: unknown): string | null {
  const text = String(value ?? '');
  if (!GITHUB_REPO.test(text)) return null;
  // A path segment cannot contain a separator or a traversal, so the origin is fixed.
  if (text.includes('..')) return null;
  return `https://github.com/${text}`;
}
