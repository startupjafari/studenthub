import { Module } from '@nestjs/common'
import { AppointmentsService } from './appointments.service'
import { AppointmentsController } from './appointments.controller'

// Домен «Запись в деканат» (docs/ACADEMIC_CORE.md, задача 16).
@Module({
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
