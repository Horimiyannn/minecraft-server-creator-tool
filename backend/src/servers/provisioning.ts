export const LOADERS = ['vanilla', 'paper', 'forge', 'neoforge'] as const;
export type Loader = (typeof LOADERS)[number];

const ITZG_TYPE: Record<Loader, string> = {
  vanilla: 'VANILLA',
  paper: 'PAPER',
  forge: 'FORGE',
  neoforge: 'NEOFORGE',
};

export interface ProvisionInput {
  loader: Loader;
  version: string;
  ramMb: number;
  rconPassword: string;
}

/**
 * Map wizard input to itzg/minecraft-server env vars. The loader BUILD
 * (e.g. exact Forge build) is left for itzg to auto-resolve from the MC
 * VERSION — Phase 1 only lets the user pick the Minecraft version.
 */
export function toItzgEnv(input: ProvisionInput): string[] {
  return [
    'EULA=TRUE',
    `TYPE=${ITZG_TYPE[input.loader]}`,
    `VERSION=${input.version}`,
    `MEMORY=${input.ramMb}M`,
    'ENABLE_RCON=TRUE',
    `RCON_PASSWORD=${input.rconPassword}`,
    'RCON_PORT=25575',
  ];
}
