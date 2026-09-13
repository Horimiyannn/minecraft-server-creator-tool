import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ServerRepository } from './server.repository';
import { PrismaService } from '../prisma/prisma.service';

function makePrismaMock(): jest.Mocked<PrismaService> {
  return {
    server: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

function knownRequestError(
  code: string,
  meta?: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('mock prisma error', {
    code,
    clientVersion: 'test',
    meta,
  });
}

describe('ServerRepository', () => {
  const data = {
    name: 'survival',
    loader: 'vanilla',
    version: '1.20.1',
    ramMb: 2048,
    port: 25565,
    rconPassword: 'secret',
  };

  // SQLite reports the clashing column in meta.target (verified live against
  // Prisma 6.19), which is what lets the client tell the two cases apart.
  it.each([
    [['name'], 'NAME_TAKEN'],
    [['port'], 'PORT_TAKEN'],
  ])('maps a P2002 on %p to a coded 409', async (target, code) => {
    const prisma = makePrismaMock();
    (prisma.server.create as jest.Mock).mockRejectedValue(
      knownRequestError('P2002', { target }),
    );
    const repo = new ServerRepository(prisma);
    await expect(repo.create(data)).rejects.toMatchObject({
      status: 409,
      response: { code },
    });
  });

  it('still returns a 409 when P2002 carries no usable target', async () => {
    const prisma = makePrismaMock();
    (prisma.server.create as jest.Mock).mockRejectedValue(
      knownRequestError('P2002'),
    );
    const repo = new ServerRepository(prisma);
    // No column to blame, so the generic message has to carry the detail.
    await expect(repo.create(data)).rejects.toMatchObject({
      status: 409,
      response: { message: expect.stringContaining('name or port') },
    });
  });

  it('rethrows non-Prisma errors from create unchanged', async () => {
    const prisma = makePrismaMock();
    const other = new Error('boom');
    (prisma.server.create as jest.Mock).mockRejectedValue(other);
    const repo = new ServerRepository(prisma);
    await expect(repo.create(data)).rejects.toBe(other);
  });

  it('translates a P2025 not-found on setStatus to NotFoundException', async () => {
    const prisma = makePrismaMock();
    (prisma.server.update as jest.Mock).mockRejectedValue(
      knownRequestError('P2025'),
    );
    const repo = new ServerRepository(prisma);
    await expect(repo.setStatus('missing', 'running')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('translates a P2025 not-found on delete to NotFoundException', async () => {
    const prisma = makePrismaMock();
    (prisma.server.delete as jest.Mock).mockRejectedValue(
      knownRequestError('P2025'),
    );
    const repo = new ServerRepository(prisma);
    await expect(repo.delete('missing')).rejects.toThrow(NotFoundException);
  });
});
