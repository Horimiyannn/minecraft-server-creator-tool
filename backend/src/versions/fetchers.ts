interface VanillaManifest {
  versions: { id: string; type: string }[];
}
/** PaperMC Fill v3: versions grouped by minor family. */
interface PaperProject {
  versions: Record<string, string[]>;
}
interface PaperBuild {
  id: number;
  channel: string;
}
interface ForgePromotions {
  promos: Record<string, string>;
}

const VERSION_TAG = /<version>([^<]+)<\/version>/g;

/**
 * Newest first, comparing dot-separated segments numerically. Minecraft moved
 * to calendar-style ids in 26.x, so this has to order "26.2" above "1.21.11" —
 * a segment-wise compare does that for free (26 > 1), where a lexical sort
 * would not.
 */
function sortVersionsDesc(versions: string[]): string[] {
  return [...versions].sort((a, b) => {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      const diff = (right[i] ?? 0) - (left[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

/** True for a plain numeric release id — rejects rc/pre/beta/snapshot ids. */
function isNumericVersion(version: string): boolean {
  return /^\d+(\.\d+)*$/.test(version);
}

/** Drop a "-beta" / "-alpha.10+snapshot-6" style qualifier. */
function stripQualifier(version: string): string {
  return version.split(/[-+]/)[0];
}

/** MC release ids never carry a trailing ".0" — "26.2.0" is really "26.2". */
function trimZeroPatch(version: string): string {
  return version.endsWith('.0') ? version.slice(0, -2) : version;
}

export function parseVanilla(json: unknown): string[] {
  const manifest = json as VanillaManifest;
  return manifest.versions.filter((v) => v.type === 'release').map((v) => v.id);
}

/**
 * Fill v3 returns families newest-first and versions newest-first within each
 * family, so the API order is authoritative — deliberately not re-sorted.
 * Pre-releases are dropped, matching parseVanilla's release-only filter.
 */
export function parsePaper(json: unknown): string[] {
  const grouped = (json as PaperProject).versions;
  return Object.values(grouped).flat().filter(isNumericVersion);
}

/** Stable builds only, so we never pin a server to an experimental jar. */
export function parsePaperBuilds(json: unknown): string[] {
  return (json as PaperBuild[])
    .filter((build) => build.channel === 'STABLE')
    .map((build) => String(build.id));
}

/** Promo keys are "<mc>-latest" / "<mc>-recommended". */
export function parseForge(json: unknown): string[] {
  const promos = (json as ForgePromotions).promos;
  const seen = new Set<string>();
  for (const key of Object.keys(promos)) {
    const split = key.lastIndexOf('-');
    if (split <= 0) continue;
    const mc = key.slice(0, split);
    if (isNumericVersion(mc)) seen.add(mc);
  }
  return sortVersionsDesc([...seen]);
}

/**
 * Forge artifact versions are "<mc>-<build>" (e.g. "1.20.1-47.2.0"). The live
 * maven-metadata.xml is not ordered, so sorting here is load-bearing.
 */
export function parseForgeBuilds(xml: string, mcVersion: string): string[] {
  const prefix = `${mcVersion}-`;
  const builds = new Set<string>();
  for (const match of xml.matchAll(VERSION_TAG)) {
    const version = match[1];
    if (!version.startsWith(prefix)) continue;
    const build = version.slice(prefix.length);
    if (isNumericVersion(build)) builds.add(build);
  }
  return sortVersionsDesc([...builds]);
}

/**
 * NeoForge artifact version -> the MC release it targets. Two schemes coexist
 * in the same metadata file:
 *   legacy  3-segment "21.1.73"     -> MC 1.21.1, build 73
 *   current 4-segment "26.1.2.108"  -> MC 26.1.2, build 108
 * The second tracks Minecraft's move to calendar-style ids in 26.x. Returns
 * null for anything whose target isn't a plain numeric release (notably the
 * "21.0w14craftmine.1-beta" April Fools snapshots).
 */
function neoforgeMcVersion(version: string): string | null {
  const core = stripQualifier(version);
  if (!isNumericVersion(core)) return null;
  const parts = core.split('.');
  if (parts.length === 3) return trimZeroPatch(`1.${parts[0]}.${parts[1]}`);
  if (parts.length >= 4) return trimZeroPatch(parts.slice(0, 3).join('.'));
  return null;
}

export function parseNeoforge(xml: string): string[] {
  const seen = new Set<string>();
  for (const match of xml.matchAll(VERSION_TAG)) {
    const mc = neoforgeMcVersion(match[1]);
    if (mc) seen.add(mc);
  }
  return sortVersionsDesc([...seen]);
}

export function parseNeoforgeBuilds(xml: string, mcVersion: string): string[] {
  const builds = new Set<string>();
  for (const match of xml.matchAll(VERSION_TAG)) {
    const version = match[1];
    // A qualifier means beta/alpha/snapshot — stable builds only.
    if (/[-+]/.test(version)) continue;
    if (neoforgeMcVersion(version) === mcVersion) builds.add(version);
  }
  return sortVersionsDesc([...builds]);
}
