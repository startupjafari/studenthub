import { Module, forwardRef } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { TagsModule } from '../tags/tags.module';
import { MentionsModule } from '../mentions/mentions.module';

@Module({
  controllers: [PostsController],
  providers: [PostsService, PrismaService, CacheService],
  imports: [forwardRef(() => TagsModule), forwardRef(() => MentionsModule)],
  exports: [PostsService],
})
export class PostsModule {}





