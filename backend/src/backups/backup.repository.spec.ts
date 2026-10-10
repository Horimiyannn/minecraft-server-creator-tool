import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BackupRepository } from './backup.repository';
import { PrismaService } from '../prisma/prisma.service';

function makePrismaMock(): jest.Mocked<PrismaService> {
  return {
    backup: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    backupSchedule: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

describe('BackupRepository', () => {
  it('lists a kind oldest-first so retention can prune from the front', async () => {
    const prisma = makePrismaMock();
    (prisma.backup.findMany as jest.Mock).mockResolvedValue([]);
    const repo = new BackupRepository(prisma);

    await repo.listByKindOldestFirst('s1', 'world');

    expect(prisma.backup.findMany).toHaveBeenCalledWith({
      where: { serverId: 's1', kind: 'world' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('maps a P2025 delete to a 404', async () => {
    const prisma = makePrismaMock();
    (prisma.backup.delete as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('missing', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );
    const repo = new BackupRepository(prisma);

    await expect(repo.delete('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 0 total bytes when a server has no backups', async () => {
    const prisma = makePrismaMock();
    (prisma.backup.aggregate as jest.Mock).mockResolvedValue({
      _sum: { sizeBytes: null },
    });
    const repo = new BackupRepository(prisma);

    await expect(repo.totalBytes('s1')).resolves.toBe(0n);
  });

  it('defaults a schedule that was never saved', async () => {
    const prisma = makePrismaMock();
    (prisma.backupSchedule.findUnique as jest.Mock).mockResolvedValue(null);
    const repo = new BackupRepository(prisma);

    await expect(repo.getSchedule('s1')).resolves.toEqual({
      serverId: 's1',
      worldEveryMin: null,
      fullEveryMin: null,
      keepWorld: 12,
      keepFull: 5,
      skipWhenEmpty: true,
      chatEnabled: true,
    });
  });
});
