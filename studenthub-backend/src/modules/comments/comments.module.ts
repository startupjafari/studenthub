import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';

@Module({
  controllers: [CommentsController],
  providers: [CommentsService, PrismaService, CacheService],
  exports: [CommentsService],
})
export class CommentsModule {}





