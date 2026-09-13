import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileToolbar } from './FileToolbar';

function toolbar(selected: string[], onOpenFile = jest.fn()) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FileToolbar
        serverId="s1"
        path="mods"
        selected={new Set(selected)}
        onOpenFile={onOpenFile}
      />
    </QueryClientProvider>
  );
}

describe('FileToolbar', () => {
  afterEach(() => jest.restoreAllMocks());

  it('creates a folder under the current path', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(window, 'prompt').mockReturnValue('newdir');

    render(toolbar([]));
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toContain('/servers/s1/files/dir');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      path: 'mods/newdir',
    });
  });

  it('only offers Compress when something is selected', () => {
    const { rerender } = render(toolbar([]));
    expect(
      screen.queryByRole('button', { name: 'Compress' }),
    ).not.toBeInTheDocument();

    rerender(toolbar(['a.jar']));
    expect(
      screen.getByRole('button', { name: 'Compress' }),
    ).toBeInTheDocument();
  });

  it('offers Extract only for a single selected zip', () => {
    const { rerender } = render(toolbar(['a.jar']));
    expect(
      screen.queryByRole('button', { name: 'Extract' }),
    ).not.toBeInTheDocument();

    rerender(toolbar(['pack.zip']));
    expect(screen.getByRole('button', { name: 'Extract' })).toBeInTheDocument();
  });
  it('creates a new file under the current path and opens it', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ ok: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(window, 'prompt').mockReturnValue('notes.txt');
    const onOpenFile = jest.fn();

    render(toolbar([], onOpenFile));
    await userEvent.click(screen.getByRole('button', { name: 'New file' }));

    await waitFor(() =>
      expect(onOpenFile).toHaveBeenCalledWith('mods/notes.txt'),
    );
    expect(fetchMock.mock.calls[0][0]).toContain('/servers/s1/files/file');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      path: 'mods/notes.txt',
    });
  });

  it('does nothing when the new-file prompt is cancelled', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(window, 'prompt').mockReturnValue(null);

    render(toolbar([]));
    await userEvent.click(screen.getByRole('button', { name: 'New file' }));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
