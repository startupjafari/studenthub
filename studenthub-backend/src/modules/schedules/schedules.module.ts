import { Module, forwardRef } from '@nestjs/common';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';
import { PrismaService } from '../../common/services/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  controllers: [SchedulesController],
  providers: [SchedulesService, PrismaService],
  imports: [forwardRef(() => NotificationsModule)],
  exports: [SchedulesService],
})
export class SchedulesModule {}


