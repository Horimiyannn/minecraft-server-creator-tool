'use client';
import Link from 'next/link';
import { ROUTES } from '@/constants';
import { Button, Spinner } from '@ui';
import { useServers, ServerCard } from '@/modules/servers';

export default function Dashboard() {
  const { data: servers, isLoading, isError } = useServers();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Servers</h1>
        <Link href={ROUTES.newServer}>
          <Button>New server</Button>
        </Link>
      </div>
      {isLoading && <Spinner />}
      {isError && <p className="text-red-400">Failed to load servers.</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {servers?.map((s) => (
          <ServerCard key={s.id} server={s} metricsSlot={null} />
        ))}
      </div>
      {servers?.length === 0 && (
        <p className="text-neutral-400">No servers yet. Create one.</p>
      )}
    </div>
  );
}
