import { Module } from '@nestjs/common';
import { ReactionsController } from './reactions.controller';
import { ReactionsService } from './reactions.service';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';

@Module({
  controllers: [ReactionsController],
  providers: [ReactionsService, PrismaService, CacheService],
  exports: [ReactionsService],
})
export class ReactionsModule {}





