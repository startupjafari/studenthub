import { Module } from '@nestjs/common'
import { ConsultationsService } from './consultations.service'
import { ConsultationsController } from './consultations.controller'

// Домен «Консультации» (docs/ACADEMIC_CORE.md, задача 15).
@Module({
  controllers: [ConsultationsController],
  providers: [ConsultationsService],
  exports: [ConsultationsService],
})
export class ConsultationsModule {}
