import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScheduleForm } from './ScheduleForm';

const schedule = {
  serverId: 's1',
  worldEveryMin: 60,
  fullEveryMin: null,
  keepWorld: 12,
  keepFull: 5,
  skipWhenEmpty: true,
  chatEnabled: true,
};

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ScheduleForm serverId="s1" schedule={schedule} />
    </QueryClientProvider>,
  );
}

describe('ScheduleForm', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(schedule),
    }) as unknown as typeof fetch;
  });

  it('shows an hourly interval as 1 hour, and sends minutes back', async () => {
    renderForm();
    expect(screen.getByLabelText('World every')).toHaveValue(1);
    expect(screen.getByLabelText('World unit')).toHaveValue('hours');

    await userEvent.clear(screen.getByLabelText('World every'));
    await userEvent.type(screen.getByLabelText('World every'), '2');
    await userEvent.click(
      screen.getByRole('button', { name: 'Save schedule' }),
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls.at(-1)![1].body,
    );
    expect(body.worldEveryMin).toBe(120);
  });

  it('clamps a keep count above 20 before sending', async () => {
    renderForm();
    await userEvent.clear(screen.getByLabelText('Keep world backups'));
    await userEvent.type(screen.getByLabelText('Keep world backups'), '99');
    await userEvent.click(
      screen.getByRole('button', { name: 'Save schedule' }),
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls.at(-1)![1].body,
    );
    expect(body.keepWorld).toBe(20);
  });
});
