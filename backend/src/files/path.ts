import * as path from 'node:path';

export class PathError extends Error {}

/**
 * Resolve a user-supplied relative path inside `root`, or throw. Leading
 * slashes are treated as root-relative (the API speaks paths relative to the
 * server's data dir, so "/mods" means "mods"), and the result must be the
 * root itself or below it — a prefix check alone would accept a sibling like
 * "<root>-evil", so the separator is part of the comparison.
 */
export function resolveInRoot(root: string, rel: string): string {
  if (rel.includes('\0')) throw new PathError('path contains a null byte');
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, `.${path.sep}${rel}`);
  if (
    resolved !== normalizedRoot &&
    !resolved.startsWith(normalizedRoot + path.sep)
  ) {
    throw new PathError(`path escapes the server directory: ${rel}`);
  }
  return resolved;
}
