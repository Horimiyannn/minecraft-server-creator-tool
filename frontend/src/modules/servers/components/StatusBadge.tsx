import { Badge } from '@ui';
import type { ServerStatus } from '@/types';
import { STATUS_TONE } from '../constants';

export function StatusBadge({ status }: { status: ServerStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}
