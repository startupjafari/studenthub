import { Module, forwardRef } from '@nestjs/common';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { PrismaService } from '../../common/services/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  controllers: [ModerationController],
  providers: [ModerationService, PrismaService],
  imports: [forwardRef(() => NotificationsModule)],
  exports: [ModerationService],
})
export class ModerationModule {}


