import { Module } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { GroupMemberGuard } from '../../common/guards/group-member.guard';

@Module({
  controllers: [GroupsController],
  providers: [GroupsService, PrismaService, CacheService, GroupMemberGuard],
  exports: [GroupsService],
})
export class GroupsModule {}





