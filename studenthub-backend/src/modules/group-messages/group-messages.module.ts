import { Module, forwardRef } from '@nestjs/common';
import { GroupMessagesController } from './group-messages.controller';
import { GroupMessagesService } from './group-messages.service';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { GroupMemberGuard } from '../../common/guards/group-member.guard';
import { WebSocketModule } from '../websocket/websocket.module';

@Module({
  imports: [forwardRef(() => WebSocketModule)],
  controllers: [GroupMessagesController],
  providers: [
    GroupMessagesService,
    PrismaService,
    CacheService,
    GroupMemberGuard,
  ],
  exports: [GroupMessagesService],
})
export class GroupMessagesModule {}

