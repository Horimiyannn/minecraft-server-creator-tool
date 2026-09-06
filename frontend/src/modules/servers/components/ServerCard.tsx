import Link from 'next/link';
import { Card, Badge } from '@ui';
import { ROUTES } from '@/constants';
import type { PublicServer } from '@/types';
import { StatusBadge } from './StatusBadge';
import { LifecycleButtons } from './LifecycleButtons';

export function ServerCard({
  server,
  metricsSlot,
}: {
  server: PublicServer;
  metricsSlot?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <Link
          href={ROUTES.server(server.id)}
          className="font-medium hover:underline"
        >
          {server.name}
        </Link>
        <StatusBadge status={server.status} />
      </div>
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <Badge tone="gray">{server.loader}</Badge>
        <span>{server.version}</span>
        <span>· :{server.port}</span>
      </div>
      {metricsSlot}
      <LifecycleButtons server={server} />
    </Card>
  );
}
