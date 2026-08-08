import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface UserRecord {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: Date;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUsername(username: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async create(username: string, passwordHash: string): Promise<UserRecord> {
    try {
      return await this.prisma.user.create({
        data: { username, passwordHash },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(`User "${username}" already exists`);
      }
      throw error;
    }
  }

  async updatePasswordHash(
    username: string,
    passwordHash: string,
  ): Promise<UserRecord> {
    try {
      return await this.prisma.user.update({
        where: { username },
        data: { passwordHash },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`User "${username}" not found`);
      }
      throw error;
    }
  }

  async delete(username: string): Promise<void> {
    try {
      await this.prisma.user.delete({ where: { username } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`User "${username}" not found`);
      }
      throw error;
    }
  }

  list(): Promise<Pick<UserRecord, 'username' | 'createdAt'>[]> {
    return this.prisma.user.findMany({
      select: { username: true, createdAt: true },
      orderBy: { username: 'asc' },
    });
  }
}
