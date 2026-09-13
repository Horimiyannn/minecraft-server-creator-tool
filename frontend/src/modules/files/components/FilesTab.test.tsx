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

/** The POST the tab sent to `/files<suffix>`, if any. */
function postTo(suffix: string) {
  return (global.fetch as jest.Mock).mock.calls.find(
    ([url, init]) =>
      init?.method === 'POST' && String(url).includes(`/files${suffix}`),
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

  it('renames an entry in place', async () => {
    const prompt = jest.spyOn(window, 'prompt').mockReturnValue('settings');
    renderTab();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Rename config' }),
    );

    await waitFor(() => expect(postTo('/rename')).toBeDefined());
    expect(JSON.parse(postTo('/rename')![1].body)).toEqual({
      from: 'config',
      to: 'settings',
    });
    prompt.mockRestore();
  });

  it('does not rename when the name is unchanged or cancelled', async () => {
    const prompt = jest
      .spyOn(window, 'prompt')
      .mockReturnValueOnce('config')
      .mockReturnValueOnce(null);
    renderTab();

    const rename = await screen.findByRole('button', { name: 'Rename config' });
    await userEvent.click(rename);
    await userEvent.click(rename);

    expect(postTo('/rename')).toBeUndefined();
    prompt.mockRestore();
  });

  it('deletes a single entry only after confirmation', async () => {
    renderTab();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete config' }),
    );
    expect(postTo('/delete')).toBeUndefined();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(postTo('/delete')).toBeDefined());
    expect(JSON.parse(postTo('/delete')![1].body)).toEqual({
      paths: ['config'],
    });
  });
});
