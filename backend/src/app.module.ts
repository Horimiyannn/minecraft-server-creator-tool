import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ServersModule } from './servers/servers.module';
import { VersionsModule } from './versions/versions.module';
import { ConsoleModule } from './console/console.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ServersModule,
    VersionsModule,
    ConsoleModule,
    MetricsModule,
  ],
})
export class AppModule {}
