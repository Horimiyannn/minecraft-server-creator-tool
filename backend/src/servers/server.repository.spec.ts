import { ConflictException, NotFoundException } from '@nestjs/common';
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

function knownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('mock prisma error', {
    code,
    clientVersion: 'test',
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

  it('translates a P2002 unique violation on create to ConflictException', async () => {
    const prisma = makePrismaMock();
    (prisma.server.create as jest.Mock).mockRejectedValue(
      knownRequestError('P2002'),
    );
    const repo = new ServerRepository(prisma);
    await expect(repo.create(data)).rejects.toThrow(ConflictException);
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
