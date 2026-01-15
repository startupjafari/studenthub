import { Module, forwardRef } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { MentionsModule } from '../mentions/mentions.module';

@Module({
  controllers: [CommentsController],
  providers: [CommentsService, PrismaService, CacheService],
  imports: [forwardRef(() => MentionsModule)],
  exports: [CommentsService],
})
export class CommentsModule {}
