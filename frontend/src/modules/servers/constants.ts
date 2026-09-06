import type { ServerStatus } from '@/types';

export const STATUS_TONE: Record<
  ServerStatus,
  'green' | 'gray' | 'red' | 'yellow'
> = {
  running: 'green',
  stopped: 'gray',
  creating: 'yellow',
  failed: 'red',
};
