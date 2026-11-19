import { Module } from '@nestjs/common'
import { ExamsService } from './exams.service'
import { ExamsController } from './exams.controller'
import { ExamEvents } from './exam-events'

// Домен «Экзамены и сессия» (docs/ACADEMIC_CORE.md, задача 11).
// ExamEvents — живой сигнал `exam.changed` (§9.2d); RealtimeGateway даёт глобальный RealtimeModule.
@Module({
  controllers: [ExamsController],
  providers: [ExamsService, ExamEvents],
  exports: [ExamsService],
})
export class ExamsModule {}
