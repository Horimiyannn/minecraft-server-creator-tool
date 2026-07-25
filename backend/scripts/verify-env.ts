import { verifyEnv } from '../src/config/env';

try {
  verifyEnv();
  console.log('Env OK');
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
