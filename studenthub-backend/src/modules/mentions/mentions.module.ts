import { Module, forwardRef } from '@nestjs/common';
import { MentionsController } from './mentions.controller';
import { MentionsService } from './mentions.service';
import { PrismaService } from '../../common/services/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  controllers: [MentionsController],
  providers: [MentionsService, PrismaService],
  imports: [forwardRef(() => NotificationsModule)],
  exports: [MentionsService],
})
export class MentionsModule {}
