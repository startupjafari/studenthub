import { Module } from '@nestjs/common';
import { UniversitiesController } from './universities.controller';
import { UniversitiesService } from './universities.service';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';

@Module({
  controllers: [UniversitiesController],
  providers: [UniversitiesService, PrismaService, CacheService],
  exports: [UniversitiesService],
})
export class UniversitiesModule {}





