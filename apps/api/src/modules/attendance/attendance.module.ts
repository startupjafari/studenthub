import { Module } from '@nestjs/common'
import { AttendanceService } from './attendance.service'
import { AttendanceController } from './attendance.controller'

// Домен «Посещаемость» (docs/ACADEMIC_CORE.md, задача 5): отметки на занятиях + сводка студента.
@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
