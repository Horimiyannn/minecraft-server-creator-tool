export const LOADERS = ['vanilla', 'paper', 'forge', 'neoforge'] as const;
export type Loader = (typeof LOADERS)[number];

const ITZG_TYPE: Record<Loader, string> = {
  vanilla: 'VANILLA',
  paper: 'PAPER',
  forge: 'FORGE',
  neoforge: 'NEOFORGE',
};

/** The env var itzg reads to pin an exact loader build. Vanilla has none. */
const BUILD_ENV: Record<Loader, string | null> = {
  vanilla: null,
  paper: 'PAPER_BUILD',
  forge: 'FORGE_VERSION',
  neoforge: 'NEOFORGE_VERSION',
};

/** Non-heap room (metaspace, GC structures, netty buffers) kept per container. */
const OVERHEAD_MB = 512;

export interface ProvisionInput {
  loader: Loader;
  version: string;
  ramMb: number;
  rconPassword: string;
  /** Exact loader build; when unset itzg resolves the latest for the MC version. */
  loaderVersion?: string | null;
}

/**
 * JVM heap to request inside a container capped at `ramMb`. The cap is the
 * whole budget, so the heap must stay under it — otherwise the kernel
 * OOM-kills the container instead of the JVM raising OutOfMemoryError. Small
 * budgets get half rather than a fixed cut, which would leave nothing.
 */
function heapMb(ramMb: number): number {
  return ramMb > OVERHEAD_MB * 2 ? ramMb - OVERHEAD_MB : Math.round(ramMb / 2);
}

/** Map wizard input to itzg/minecraft-server env vars. */
export function toItzgEnv(input: ProvisionInput): string[] {
  const env = [
    'EULA=TRUE',
    `TYPE=${ITZG_TYPE[input.loader]}`,
    `VERSION=${input.version}`,
    `MEMORY=${heapMb(input.ramMb)}M`,
    'ENABLE_RCON=TRUE',
    `RCON_PASSWORD=${input.rconPassword}`,
    'RCON_PORT=25575',
  ];
  const buildEnv = BUILD_ENV[input.loader];
  if (buildEnv && input.loaderVersion) {
    env.push(`${buildEnv}=${input.loaderVersion}`);
  }
  return env;
}
