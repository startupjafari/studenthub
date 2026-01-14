import { Module } from '@nestjs/common';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';

@Module({
  controllers: [TagsController],
  providers: [TagsService, PrismaService, CacheService],
  exports: [TagsService],
})
export class TagsModule {}




