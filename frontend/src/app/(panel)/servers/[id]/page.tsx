'use client';
import { use, useState } from 'react';
import { Spinner, Tabs } from '@ui';
import {
  useServer,
  StatusBadge,
  LifecycleButtons,
  SettingsTab,
} from '@/modules/servers';
import { ConsoleTab } from '@/modules/console';
import { MetricsTab } from '@/modules/metrics';
import { FilesTab } from '@/modules/files';
import { BackupsTab } from '@/modules/backups';

type TabKey = 'console' | 'metrics' | 'files' | 'backups' | 'settings';

export default function ServerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [tab, setTab] = useState<TabKey>('console');
  const { data: server, isLoading, isError } = useServer(id);

  if (isLoading) return <Spinner />;
  if (isError || !server)
    return <p className="text-red-400">Server not found.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{server.name}</h1>
          <StatusBadge status={server.status} />
        </div>
        <LifecycleButtons server={server} />
      </div>
      <Tabs<TabKey>
        current={tab}
        onChange={setTab}
        tabs={[
          { key: 'console', label: 'Console' },
          { key: 'metrics', label: 'Metrics' },
          { key: 'files', label: 'Files' },
          { key: 'backups', label: 'Backups' },
          { key: 'settings', label: 'Settings' },
        ]}
      />
      {tab === 'console' && <ConsoleTab serverId={server.id} />}
      {tab === 'metrics' && <MetricsTab serverId={server.id} />}
      {tab === 'files' && <FilesTab serverId={server.id} />}
      {tab === 'backups' && <BackupsTab serverId={server.id} />}
      {tab === 'settings' && <SettingsTab server={server} />}
    </div>
  );
}
