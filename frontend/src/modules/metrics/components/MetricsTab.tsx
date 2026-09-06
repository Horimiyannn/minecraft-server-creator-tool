'use client';
import { Card } from '@ui';
import { useServerStats } from '../hooks';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs text-neutral-400">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </Card>
  );
}

export function MetricsTab({ serverId }: { serverId: string }) {
  const stats = useServerStats(serverId);
  if (!stats) return <p className="text-neutral-400">Waiting for stats…</p>;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <Metric label="CPU" value={`${stats.cpuPct.toFixed(0)}%`} />
      <Metric
        label="Memory"
        value={`${stats.memUsedMb} / ${stats.memLimitMb} MB`}
      />
      <Metric label="Disk" value={`${stats.diskMb} MB`} />
    </div>
  );
}
