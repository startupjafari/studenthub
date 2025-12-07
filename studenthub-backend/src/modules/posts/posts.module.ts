import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';

@Module({
  controllers: [PostsController],
  providers: [PostsService, PrismaService, CacheService],
  exports: [PostsService],
})
export class PostsModule {}





