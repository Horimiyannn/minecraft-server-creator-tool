import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { login } from '../api';
import { LoginForm } from './LoginForm';

jest.mock('../api');

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LoginForm />
    </QueryClientProvider>,
  );
}

describe('LoginForm', () => {
  afterEach(() => jest.clearAllMocks());

  it('submits credentials and redirects on success', async () => {
    (login as jest.Mock).mockResolvedValue({ username: 'admin' });
    renderForm();
    await userEvent.type(screen.getByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith(
        { username: 'admin', password: 'pw' },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'));
  });

  it('shows an error on failed login', async () => {
    (login as jest.Mock).mockRejectedValue(new Error('Invalid'));
    renderForm();
    await userEvent.type(screen.getByLabelText('Username'), 'x');
    await userEvent.type(screen.getByLabelText('Password'), 'y');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });
});
