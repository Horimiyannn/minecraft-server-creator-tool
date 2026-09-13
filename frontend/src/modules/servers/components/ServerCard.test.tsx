import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServerCard } from './ServerCard';
import type { PublicServer } from '@/types';

const server: PublicServer = {
  id: 's1',
  name: 'survival',
  loader: 'paper',
  version: '1.20.1',
  loaderVersion: null,
  ramMb: 2048,
  port: 25565,
  containerId: 'c1',
  status: 'running',
  createdAt: new Date(0).toISOString(),
};

it('renders name, loader, version and status', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ServerCard server={server} />
    </QueryClientProvider>,
  );
  expect(screen.getByText('survival')).toBeInTheDocument();
  expect(screen.getByText('paper')).toBeInTheDocument();
  expect(screen.getByText('1.20.1')).toBeInTheDocument();
  expect(screen.getByText('running')).toBeInTheDocument();
});
