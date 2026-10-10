import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackupsTab } from './BackupsTab';

const backup = {
  id: 'b1',
  serverId: 's1',
  kind: 'full',
  trigger: 'schedule',
  label: null,
  sizeBytes: 1024 * 1024 * 3,
  createdAt: new Date().toISOString(),
};

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BackupsTab serverId="s1" />
    </QueryClientProvider>,
  );
}

describe('BackupsTab', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () =>
        String(url).includes('schedule')
          ? JSON.stringify({
              serverId: 's1',
              worldEveryMin: 60,
              fullEveryMin: null,
              keepWorld: 12,
              keepFull: 5,
              skipWhenEmpty: true,
              chatEnabled: true,
            })
          : JSON.stringify([backup]),
    })) as unknown as typeof fetch;
  });

  it('lists a backup with its kind, trigger and size', async () => {
    renderTab();
    expect(await screen.findByText('full')).toBeInTheDocument();
    expect(screen.getByText('schedule')).toBeInTheDocument();
    expect(screen.getByText('3.0 MB')).toBeInTheDocument();
  });

  it('requires confirmation before restoring', async () => {
    renderTab();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Restore' }),
    );

    expect(
      screen.getByText(/stops the server and replaces/i),
    ).toBeInTheDocument();

    const calls = () =>
      (global.fetch as jest.Mock).mock.calls.filter((c) =>
        String(c[0]).includes('/restore'),
      );
    expect(calls()).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Restore now' }));
    await waitFor(() => expect(calls()).toHaveLength(1));
  });
});
