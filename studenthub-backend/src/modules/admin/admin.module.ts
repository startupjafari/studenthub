import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, PrismaService, CacheService],
  exports: [AdminService],
})
export class AdminModule {}





