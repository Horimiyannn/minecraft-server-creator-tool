'use client';
import { useState } from 'react';
import { Button, Spinner } from '@ui';
import { useServers, ServerCard, CreateServerModal } from '@/modules/servers';
import { LiveCpuRam } from '@/modules/metrics';

export default function Dashboard() {
  const { data: servers, isLoading, isError } = useServers();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Servers</h1>
        <Button onClick={() => setCreating(true)}>New server</Button>
      </div>
      {isLoading && <Spinner />}
      {isError && <p className="text-red-400">Failed to load servers.</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {servers?.map((s) => (
          <ServerCard
            key={s.id}
            server={s}
            metricsSlot={
              s.status === 'running' ? <LiveCpuRam serverId={s.id} /> : null
            }
          />
        ))}
      </div>
      {servers?.length === 0 && (
        <p className="text-neutral-400">No servers yet. Create one.</p>
      )}
      <CreateServerModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
