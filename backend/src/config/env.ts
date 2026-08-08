const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'] as const;

export function verifyEnv(env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
