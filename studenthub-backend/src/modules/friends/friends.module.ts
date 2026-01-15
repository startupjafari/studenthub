import { Module } from '@nestjs/common';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';

@Module({
  controllers: [FriendsController],
  providers: [FriendsService, PrismaService, CacheService],
  exports: [FriendsService],
})
export class FriendsModule {}
