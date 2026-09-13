import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileTable } from './FileTable';

const entries = [
  { name: 'mods', type: 'dir' as const, sizeBytes: 0, mtimeMs: 1700000000000 },
  {
    name: 'server.properties',
    type: 'file' as const,
    sizeBytes: 2048,
    mtimeMs: 1700000000000,
  },
];

describe('FileTable', () => {
  it('shows directories first with a human-readable size', () => {
    render(
      <FileTable
        entries={entries}
        selected={new Set()}
        onToggle={jest.fn()}
        onOpen={jest.fn()}
        onRename={jest.fn()}
        onDelete={jest.fn()}
        serverId="s1"
      />,
    );
    const rows = screen.getAllByRole('row').slice(1); // skip the header
    expect(rows[0]).toHaveTextContent('mods');
    expect(rows[1]).toHaveTextContent('2.0 KB');
  });

  it('opens an entry on name click', async () => {
    const onOpen = jest.fn();
    render(
      <FileTable
        entries={entries}
        selected={new Set()}
        onToggle={jest.fn()}
        onOpen={onOpen}
        onRename={jest.fn()}
        onDelete={jest.fn()}
        serverId="s1"
      />,
    );
    await userEvent.click(screen.getByText('mods'));
    expect(onOpen).toHaveBeenCalledWith(entries[0]);
  });

  it('offers per-row rename and delete', async () => {
    const onRename = jest.fn();
    const onDelete = jest.fn();
    render(
      <FileTable
        entries={entries}
        selected={new Set()}
        onToggle={jest.fn()}
        onOpen={jest.fn()}
        onRename={onRename}
        onDelete={onDelete}
        serverId="s1"
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Rename server.properties' }),
    );
    expect(onRename).toHaveBeenCalledWith(entries[1]);

    await userEvent.click(screen.getByRole('button', { name: 'Delete mods' }));
    expect(onDelete).toHaveBeenCalledWith(entries[0]);
  });
});
