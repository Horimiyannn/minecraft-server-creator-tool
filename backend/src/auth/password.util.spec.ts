import { hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('hunter2');
    expect(hash).not.toEqual('hunter2');
    expect(await verifyPassword('hunter2', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('hunter2');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});
