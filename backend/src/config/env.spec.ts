import { verifyEnv } from './env';

describe('verifyEnv', () => {
  it('passes when all required vars are present', () => {
    expect(() =>
      verifyEnv({
        DATABASE_URL: 'file:./x.db',
        JWT_SECRET: 's',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('throws listing every missing var', () => {
    expect(() => verifyEnv({} as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_URL.*JWT_SECRET/,
    );
  });
});
