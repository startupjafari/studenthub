import { Module } from '@nestjs/common'
import { RoomsModule } from '../rooms/rooms.module'
import { SchedulesService } from './schedules.service'
import { SchedulesController } from './schedules.controller'
import { PairsController } from './pairs.controller'
import { ScheduleViewController } from './schedule-view.controller'

// Расписание (docs/PROJECT.md §3.1, задачи Ф6.3–6.6). Владеет Schedule/Pair/ScheduleChange.
// RoomsModule — для проверки принадлежности аудитории вузу. RealtimeGateway (WS schedule:changed)
// и QueueService (job schedule-changed) — из глобальных RealtimeModule/QueueModule.
@Module({
  imports: [RoomsModule],
  controllers: [SchedulesController, PairsController, ScheduleViewController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
