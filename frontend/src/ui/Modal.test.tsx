import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

function Harness({ startOpen = true }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <Modal open={open} onClose={() => setOpen(false)} title="New server">
        <p>body</p>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(<Harness startOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes the title as the dialog accessible name', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: 'New server' })).toBeVisible();
    expect(screen.getByText('body')).toBeVisible();
  });

  it('closes via the close button', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on a backdrop click but not on a click inside the panel', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText('body'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reopens after being closed', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
