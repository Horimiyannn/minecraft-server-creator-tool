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

  it('resetPassword throws NotFoundException when user does not exist', async () => {
    const repo = makeRepoMock();
    repo.findByUsername.mockResolvedValue(null);
    const svc = new UsersService(repo);
    await expect(svc.resetPassword('alice', 'newpw')).rejects.toThrow(
      /not found/,
    );
    expect(repo.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('resetPassword stores a bcrypt hash, not the plaintext', async () => {
    const repo = makeRepoMock();
    repo.findByUsername.mockResolvedValue({
      id: 1,
      username: 'alice',
      passwordHash: await hashPassword('old'),
      createdAt: new Date(),
    });
    const svc = new UsersService(repo);
    await svc.resetPassword('alice', 'newpw');
    const [username, storedHash] = repo.updatePasswordHash.mock.calls[0];
    expect(username).toEqual('alice');
    expect(storedHash).not.toEqual('newpw');
    expect(await verifyStored(storedHash, 'newpw')).toBe(true);
  });

  it('deleteUser throws NotFoundException when user does not exist', async () => {
    const repo = makeRepoMock();
    repo.findByUsername.mockResolvedValue(null);
    const svc = new UsersService(repo);
    await expect(svc.deleteUser('alice')).rejects.toThrow(/not found/);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('deleteUser calls repo.delete when user exists', async () => {
    const repo = makeRepoMock();
    repo.findByUsername.mockResolvedValue({
      id: 1,
      username: 'alice',
      passwordHash: 'hash',
      createdAt: new Date(),
    });
    const svc = new UsersService(repo);
    await svc.deleteUser('alice');
    expect(repo.delete).toHaveBeenCalledWith('alice');
  });

  it('listUsers returns what repo.list returns', async () => {
    const repo = makeRepoMock();
    const users = [{ username: 'alice', createdAt: new Date() }];
    repo.list.mockResolvedValue(users);
    const svc = new UsersService(repo);
    expect(await svc.listUsers()).toBe(users);
  });
});

async function verifyStored(hash: string, plain: string): Promise<boolean> {
  const { verifyPassword } = await import('../auth/password.util');
  return verifyPassword(plain, hash);
}
