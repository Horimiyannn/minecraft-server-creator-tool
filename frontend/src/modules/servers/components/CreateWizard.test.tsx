import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import * as serversApi from '../api';
import * as versionsApi from '@/modules/versions/api';
import { CreateWizard } from './CreateWizard';

jest.mock('../api');
jest.mock('@/modules/versions/api');

const onCreated = jest.fn();

function renderWizard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CreateWizard onCreated={onCreated} />
    </QueryClientProvider>,
  );
}

describe('CreateWizard', () => {
  beforeEach(() => {
    (versionsApi.fetchVersions as jest.Mock).mockResolvedValue([
      '1.20.1',
      '1.20.2',
    ]);
    (versionsApi.fetchBuilds as jest.Mock).mockResolvedValue([
      '47.2.0',
      '47.1.0',
    ]);
  });
  afterEach(() => jest.clearAllMocks());

  async function waitForVersions() {
    await waitFor(() =>
      expect(screen.getByLabelText('Version')).not.toBeDisabled(),
    );
  }

  it('creates a server and reports the new id', async () => {
    (serversApi.createServer as jest.Mock).mockResolvedValue({
      id: 'new1',
    } as never);

    renderWizard();
    await userEvent.type(screen.getByLabelText('Name'), 'survival');
    await waitForVersions();
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
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new1'));
  });

  // The default used to be versions[0] of an ascending list, which is how a
  // forge server got created against Minecraft 1.1 and failed to install.
  it('defaults the version to the newest the backend lists', async () => {
    (serversApi.createServer as jest.Mock).mockResolvedValue({ id: 'n' });
    renderWizard();
    await userEvent.type(screen.getByLabelText('Name'), 'survival');
    await waitForVersions();
    expect(screen.getByLabelText('Version')).toHaveValue('1.20.1');
  });

  it('hides the build select for vanilla, which has no loader jar', async () => {
    renderWizard();
    await waitForVersions();
    expect(screen.queryByLabelText(/build/)).not.toBeInTheDocument();
  });

  it('sends the pinned loader build when one is chosen', async () => {
    (serversApi.createServer as jest.Mock).mockResolvedValue({ id: 'n' });
    renderWizard();
    await userEvent.type(screen.getByLabelText('Name'), 'survival');
    await userEvent.selectOptions(screen.getByLabelText('Loader'), 'forge');
    await waitFor(() =>
      expect(screen.getByLabelText('forge build')).not.toBeDisabled(),
    );
    await userEvent.selectOptions(
      screen.getByLabelText('forge build'),
      '47.2.0',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(serversApi.createServer).toHaveBeenCalledWith(
        expect.objectContaining({ loader: 'forge', loaderVersion: '47.2.0' }),
        expect.anything(),
      ),
    );
  });

  it('omits loaderVersion entirely when left on auto', async () => {
    (serversApi.createServer as jest.Mock).mockResolvedValue({ id: 'n' });
    renderWizard();
    await userEvent.type(screen.getByLabelText('Name'), 'survival');
    await userEvent.selectOptions(screen.getByLabelText('Loader'), 'forge');
    await waitForVersions();
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(serversApi.createServer).toHaveBeenCalled());
    const body = (serversApi.createServer as jest.Mock).mock.calls[0][0];
    expect(body).not.toHaveProperty('loaderVersion');
  });

  it('drops a pinned build when the MC version changes', async () => {
    (serversApi.createServer as jest.Mock).mockResolvedValue({ id: 'n' });
    renderWizard();
    await userEvent.type(screen.getByLabelText('Name'), 'survival');
    await userEvent.selectOptions(screen.getByLabelText('Loader'), 'forge');
    await waitFor(() =>
      expect(screen.getByLabelText('forge build')).not.toBeDisabled(),
    );
    await userEvent.selectOptions(
      screen.getByLabelText('forge build'),
      '47.2.0',
    );
    // Builds are per MC version, so the old pin must not survive.
    await userEvent.selectOptions(screen.getByLabelText('Version'), '1.20.2');
    expect(screen.getByLabelText('forge build')).toHaveValue('');
  });

  it('shows mapped copy for a coded backend error, not the raw message', async () => {
    (serversApi.createServer as jest.Mock).mockRejectedValue(
      new ApiError(
        409,
        'Bind for 0.0.0.0:25565 failed: port is already allocated',
        'PORT_IN_USE',
      ),
    );
    renderWizard();
    await userEvent.type(screen.getByLabelText('Name'), 'survival');
    await waitForVersions();
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'That port is already in use on this machine. Try a different port.',
    );
    expect(alert).not.toHaveTextContent('port is already allocated');
  });

  it('clears the error when a corrected retry succeeds', async () => {
    (serversApi.createServer as jest.Mock)
      .mockRejectedValueOnce(new ApiError(409, '', 'PORT_IN_USE'))
      .mockResolvedValueOnce({ id: 'new1' });
    renderWizard();
    await userEvent.type(screen.getByLabelText('Name'), 'survival');
    await waitForVersions();
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByRole('alert');

    await userEvent.clear(screen.getByLabelText('Port'));
    await userEvent.type(screen.getByLabelText('Port'), '25570');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new1'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
