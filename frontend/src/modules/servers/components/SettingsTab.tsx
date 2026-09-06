'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card } from '@ui';
import { ROUTES } from '@/constants';
import type { PublicServer } from '@/types';
import { useDeleteServer } from '../hooks';

export function SettingsTab({ server }: { server: PublicServer }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const { mutate: remove, isPending } = useDeleteServer();

  const rows: [string, string | number][] = [
    ['Loader', server.loader],
    ['Version', server.version],
    ['RAM (MB)', server.ramMb],
    ['Port', server.port],
    ['Status', server.status],
  ];

  return (
    <div className="flex max-w-md flex-col gap-4">
      <Card className="flex flex-col gap-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm">
            <span className="text-neutral-400">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </Card>
      <Card className="flex flex-col gap-3">
        <span className="text-sm font-medium text-red-400">Danger zone</span>
        {!confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete server
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="danger"
              loading={isPending}
              onClick={() =>
                remove(server.id, {
                  onSuccess: () => router.push(ROUTES.dashboard),
                })
              }
            >
              Confirm delete
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
