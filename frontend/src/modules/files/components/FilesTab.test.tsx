import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FilesTab } from './FilesTab';

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FilesTab serverId="s1" />
    </QueryClientProvider>,
  );
}

describe('FilesTab', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify([
          { name: 'config', type: 'dir', sizeBytes: 0, mtimeMs: 1 },
        ]),
    }) as unknown as typeof fetch;
  });

  it('navigates into a directory and back via the breadcrumb', async () => {
    renderTab();
    await userEvent.click(await screen.findByText('config'));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('path=config'),
        expect.anything(),
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'data' }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringMatching(/files\?path=$/),
        expect.anything(),
      ),
    );
  });
});
