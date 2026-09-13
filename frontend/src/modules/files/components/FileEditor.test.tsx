import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileEditor } from './FileEditor';

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FileEditor serverId="s1" path="server.properties" onClose={jest.fn()} />
    </QueryClientProvider>,
  );
}

describe('FileEditor', () => {
  it('loads content and sends the loaded mtime back on save', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ content: 'level-name=world', mtimeMs: 111 }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ mtimeMs: 222 }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderEditor();
    const box = await screen.findByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, 'level-name=new');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT'),
      ).toBe(true),
    );
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(put![1].body)).toEqual({
      path: 'server.properties',
      content: 'level-name=new',
      mtimeMs: 111,
    });
  });

  it('surfaces a 409 as a changed-on-disk warning', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ content: 'a', mtimeMs: 111 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        text: async () =>
          JSON.stringify({
            code: 'FILE_CHANGED',
            message: 'file changed on disk since it was opened',
          }),
      }) as unknown as typeof fetch;

    renderEditor();
    await screen.findByRole('textbox');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/changed on disk/i)).toBeInTheDocument();
  });
});
