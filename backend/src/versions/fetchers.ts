interface VanillaManifest {
  versions: { id: string; type: string }[];
}
interface PaperProject {
  versions: string[];
}
interface ForgePromotions {
  promos: Record<string, string>;
}

export function parseVanilla(json: unknown): string[] {
  const manifest = json as VanillaManifest;
  return manifest.versions.filter((v) => v.type === 'release').map((v) => v.id);
}

export function parsePaper(json: unknown): string[] {
  const project = json as PaperProject;
  return [...project.versions].reverse();
}

export function parseForge(json: unknown): string[] {
  const promos = (json as ForgePromotions).promos;
  const seen = new Set<string>();
  for (const key of Object.keys(promos)) {
    const mc = key.split('-')[0];
    if (mc) seen.add(mc);
  }
  return [...seen];
}

export function parseNeoforge(xml: string): string[] {
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
    const parts = match[1].split('.');
    if (parts.length >= 2) seen.add(`1.${parts[0]}.${parts[1]}`);
  }
  return [...seen];
}
