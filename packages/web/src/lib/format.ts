/**
 * Pure formatting utilities safe for both server and client components.
 * No side effects, no external dependencies.
 */

/**
 * Humanize a git branch name into a readable title.
 * e.g., "feat/infer-project-id" → "Infer Project ID"
 *       "fix/broken-auth-flow"  → "Broken Auth Flow"
 *       "session/ao-52"         → "ao-52"
 */
export function humanizeBranch(branch: string): string {
  // Remove common prefixes (feat/, fix/, chore/, session/, etc.)
  const withoutPrefix = branch.replace(/^(?:feat|fix|chore|refactor|docs|test|ci|session)\//, "");
  // Replace hyphens and underscores with spaces, then title-case each word
  return withoutPrefix
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
