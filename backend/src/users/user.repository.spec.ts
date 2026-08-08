import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UserRepository } from './user.repository';
import { PrismaService } from '../prisma/prisma.service';

function makePrismaMock(): jest.Mocked<PrismaService> {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

function knownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('mock prisma error', {
    code,
    clientVersion: 'test',
  });
}

describe('UserRepository', () => {
  describe('create', () => {
    it('rethrows a P2002 unique-constraint violation as ConflictException', async () => {
      const prisma = makePrismaMock();
      (prisma.user.create as jest.Mock).mockRejectedValue(
        knownRequestError('P2002'),
      );
      const repo = new UserRepository(prisma);

      await expect(repo.create('alice', 'hash')).rejects.toThrow(
        ConflictException,
      );
      await expect(repo.create('alice', 'hash')).rejects.toThrow(
        /User "alice" already exists/,
      );
    });

    it('rethrows other errors unchanged', async () => {
      const prisma = makePrismaMock();
      const otherError = new Error('some other db error');
      (prisma.user.create as jest.Mock).mockRejectedValue(otherError);
      const repo = new UserRepository(prisma);

      await expect(repo.create('alice', 'hash')).rejects.toBe(otherError);
    });
  });

  describe('updatePasswordHash', () => {
    it('rethrows a P2025 record-not-found error as NotFoundException', async () => {
      const prisma = makePrismaMock();
      (prisma.user.update as jest.Mock).mockRejectedValue(
        knownRequestError('P2025'),
      );
      const repo = new UserRepository(prisma);

      await expect(repo.updatePasswordHash('alice', 'newhash')).rejects.toThrow(
        NotFoundException,
      );
      await expect(repo.updatePasswordHash('alice', 'newhash')).rejects.toThrow(
        /User "alice" not found/,
      );
    });

    it('rethrows other errors unchanged', async () => {
      const prisma = makePrismaMock();
      const otherError = new Error('some other db error');
      (prisma.user.update as jest.Mock).mockRejectedValue(otherError);
      const repo = new UserRepository(prisma);

      await expect(repo.updatePasswordHash('alice', 'newhash')).rejects.toBe(
        otherError,
      );
    });
  });

  describe('delete', () => {
    it('rethrows a P2025 record-not-found error as NotFoundException', async () => {
      const prisma = makePrismaMock();
      (prisma.user.delete as jest.Mock).mockRejectedValue(
        knownRequestError('P2025'),
      );
      const repo = new UserRepository(prisma);

      await expect(repo.delete('alice')).rejects.toThrow(NotFoundException);
      await expect(repo.delete('alice')).rejects.toThrow(
        /User "alice" not found/,
      );
    });

    it('rethrows other errors unchanged', async () => {
      const prisma = makePrismaMock();
      const otherError = new Error('some other db error');
      (prisma.user.delete as jest.Mock).mockRejectedValue(otherError);
      const repo = new UserRepository(prisma);

      await expect(repo.delete('alice')).rejects.toBe(otherError);
    });
  });
});
