import { render, screen } from '@testing-library/react';
import { MetricsTab } from './MetricsTab';

jest.mock('../hooks', () => ({
  useServerStats: () => ({
    serverId: 's1',
    cpuPct: 12,
    memUsedMb: 600,
    memLimitMb: 2048,
    diskMb: 900,
    backupsMb: 150,
  }),
}));

describe('MetricsTab', () => {
  it('shows disk and backup usage as separate figures', () => {
    render(<MetricsTab serverId="s1" />);

    expect(screen.getByText(/Data/)).toBeInTheDocument();
    expect(screen.getByText('900 MB')).toBeInTheDocument();
    expect(screen.getByText(/Backups/)).toBeInTheDocument();
    expect(screen.getByText('150 MB')).toBeInTheDocument();
  });
});
