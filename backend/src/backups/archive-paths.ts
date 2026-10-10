import { BackupKind } from './backup.repository';

/**
 * Paths excluded from a full backup. Rebuildable or noisy only — `mods/`,
 * `plugins/` and `config/` must stay, or a "full" backup cannot revive a
 * modded server. `./*.jar` is anchored at the root on purpose: it drops the
 * server jar without touching mod jars in `mods/`.
 */
export const FULL_EXCLUDES = [
  './logs',
  './cache',
  './crash-reports',
  './libraries',
  './versions',
  './*.jar',
];

export function levelName(serverProperties: string): string {
  for (const line of serverProperties.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    const match = /^level-name\s*=\s*(.*)$/.exec(trimmed);
    if (match) {
      const value = match[1].trim();
      if (value) return value;
    }
  }
  return 'world';
}

/** The dimension folders a world snapshot covers, filtered to what exists. */
export function worldDirs(level: string, existing: string[]): string[] {
  const candidates = [level, `${level}_nether`, `${level}_the_end`];
  const present = new Set(existing);
  return candidates.filter((dir) => present.has(dir));
}

export function archiveName(
  kind: BackupKind,
  at: Date,
  label?: string | null,
): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  const suffix = label ? `-${slug(label)}` : '';
  return `${kind}-${stamp}${suffix}.tar.zst`;
}

/**
 * Labels come from chat, so they are untrusted: reduce to lowercase words
 * joined by hyphens, which cannot contain a separator or a dot-dot.
 */
function slug(label: string): string {
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-')
    .slice(0, 40);
}
