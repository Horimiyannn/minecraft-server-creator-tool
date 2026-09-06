'use client';
import { useServerStats } from '../hooks';

export function LiveCpuRam({ serverId }: { serverId: string }) {
  const stats = useServerStats(serverId);
  if (!stats)
    return <div className="text-xs text-neutral-500">connecting…</div>;
  return (
    <div className="flex gap-4 text-xs text-neutral-300">
      <span>CPU {stats.cpuPct.toFixed(0)}%</span>
      <span>
        RAM {stats.memUsedMb}/{stats.memLimitMb} MB
      </span>
    </div>
  );
}
