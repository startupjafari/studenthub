import { Module } from '@nestjs/common'
import { AttendanceEvents } from './attendance-events'
import { AttendanceService } from './attendance.service'
import { AttendanceController } from './attendance.controller'

// Домен «Посещаемость» (docs/ACADEMIC_CORE.md, задача 5): отметки на занятиях + сводка студента.
// AttendanceEvents — живой сигнал `attendance.changed` (RealtimeModule глобальный).
@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceEvents],
  exports: [AttendanceService],
})
export class AttendanceModule {}
