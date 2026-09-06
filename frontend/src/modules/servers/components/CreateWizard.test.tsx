import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as serversApi from '../api';
import * as versionsApi from '@/modules/versions/api';
import { CreateWizard } from './CreateWizard';

jest.mock('../api');
jest.mock('@/modules/versions/api');

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

function renderWizard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CreateWizard />
    </QueryClientProvider>,
  );
}

describe('CreateWizard', () => {
  afterEach(() => jest.clearAllMocks());

  it('creates a server and navigates to its detail page', async () => {
    (versionsApi.fetchVersions as jest.Mock).mockResolvedValue([
      '1.20.1',
      '1.20.2',
    ]);
    (serversApi.createServer as jest.Mock).mockResolvedValue({
      id: 'new1',
    } as never);

    renderWizard();
    await userEvent.type(screen.getByLabelText('Name'), 'survival');
    await waitFor(() =>
      expect(screen.getByLabelText('Version')).not.toBeDisabled(),
    );
    await userEvent.selectOptions(screen.getByLabelText('Version'), '1.20.2');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(serversApi.createServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'survival',
          loader: 'vanilla',
          version: '1.20.2',
        }),
        expect.anything(),
      ),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/servers/new1'));
  });
});
