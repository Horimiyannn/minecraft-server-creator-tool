import { Injectable } from '@nestjs/common';
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

  create(username: string, passwordHash: string): Promise<UserRecord> {
    return this.prisma.user.create({ data: { username, passwordHash } });
  }

  updatePasswordHash(
    username: string,
    passwordHash: string,
  ): Promise<UserRecord> {
    return this.prisma.user.update({
      where: { username },
      data: { passwordHash },
    });
  }

  async delete(username: string): Promise<void> {
    await this.prisma.user.delete({ where: { username } });
  }

  list(): Promise<Pick<UserRecord, 'username' | 'createdAt'>[]> {
    return this.prisma.user.findMany({
      select: { username: true, createdAt: true },
      orderBy: { username: 'asc' },
    });
  }
}
