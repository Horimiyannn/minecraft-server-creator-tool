/**
 * Optional vars (defaulted, never required):
 *   MC_DATA_ROOT  — per-server data root (default /srv/mc)
 *   MC_IMAGE      — server image (default itzg/minecraft-server)
 *   MAX_UPLOAD_MB — file-manager upload cap in MB (default 512)
 */
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'] as const;

export function verifyEnv(env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
