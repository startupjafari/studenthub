import { Module } from '@nestjs/common'
import { SchedulesModule } from '../schedules/schedules.module'
import { EventsModule } from '../events/events.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { AssignmentsModule } from '../assignments/assignments.module'
import { ApplicationServicesModule } from '../application-services/application-services.module'
import { MeController } from './me.controller'
import { MeService } from './me.service'

// BFF-слой главных экранов. Переиспользует доменные сервисы (импорт модулей, не копирование
// логики); физического слияния доменов нет. См. docs/UNIFIED_UX.md PR-1.
@Module({
  imports: [
    SchedulesModule,
    EventsModule,
    NotificationsModule,
    AssignmentsModule,
    ApplicationServicesModule,
  ],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
