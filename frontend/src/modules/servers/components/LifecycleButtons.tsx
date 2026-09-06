'use client';
import { Button } from '@ui';
import type { PublicServer } from '@/types';
import { useServerLifecycle } from '../hooks';

export function LifecycleButtons({ server }: { server: PublicServer }) {
  const { start, stop, restart } = useServerLifecycle();
  const running = server.status === 'running';
  return (
    <div className="flex gap-2">
      <Button
        variant="ghost"
        disabled={running}
        loading={start.isPending}
        onClick={() => start.mutate(server.id)}
      >
        Start
      </Button>
      <Button
        variant="ghost"
        disabled={!running}
        loading={stop.isPending}
        onClick={() => stop.mutate(server.id)}
      >
        Stop
      </Button>
      <Button
        variant="ghost"
        loading={restart.isPending}
        onClick={() => restart.mutate(server.id)}
      >
        Restart
      </Button>
    </div>
  );
}
