import { Module } from '@nestjs/common';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';

@Module({
  controllers: [StoriesController],
  providers: [StoriesService, PrismaService, CacheService],
  exports: [StoriesService],
})
export class StoriesModule {}





