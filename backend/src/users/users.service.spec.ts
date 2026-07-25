import { UsersService } from './users.service';
import { UserRepository, UserRecord } from './user.repository';
import { hashPassword } from '../auth/password.util';

function makeRepoMock(): jest.Mocked<UserRepository> {
  return {
    findByUsername: jest.fn(),
    create: jest.fn(),
    updatePasswordHash: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(),
  } as unknown as jest.Mocked<UserRepository>;
}

describe('UsersService', () => {
  it('createUser throws when username already exists', async () => {
    const repo = makeRepoMock();
    repo.findByUsername.mockResolvedValue({ id: 1 } as UserRecord);
    const svc = new UsersService(repo);
    await expect(svc.createUser('alice', 'pw')).rejects.toThrow(/exists/);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('createUser stores a bcrypt hash, not the plaintext', async () => {
    const repo = makeRepoMock();
    repo.findByUsername.mockResolvedValue(null);
    const svc = new UsersService(repo);
    await svc.createUser('alice', 'pw');
    const [, storedHash] = repo.create.mock.calls[0];
    expect(storedHash).not.toEqual('pw');
    expect(await verifyStored(storedHash, 'pw')).toBe(true);
  });

  it('validateCredentials returns null for wrong password', async () => {
    const repo = makeRepoMock();
    repo.findByUsername.mockResolvedValue({
      id: 1,
      username: 'alice',
      passwordHash: await hashPassword('right'),
      createdAt: new Date(),
    });
    const svc = new UsersService(repo);
    expect(await svc.validateCredentials('alice', 'wrong')).toBeNull();
  });

  it('validateCredentials returns id+username for correct password', async () => {
    const repo = makeRepoMock();
    repo.findByUsername.mockResolvedValue({
      id: 7,
      username: 'alice',
      passwordHash: await hashPassword('right'),
      createdAt: new Date(),
    });
    const svc = new UsersService(repo);
    expect(await svc.validateCredentials('alice', 'right')).toEqual({
      id: 7,
      username: 'alice',
    });
  });
});

async function verifyStored(hash: string, plain: string): Promise<boolean> {
  const { verifyPassword } = await import('../auth/password.util');
  return verifyPassword(plain, hash);
}
