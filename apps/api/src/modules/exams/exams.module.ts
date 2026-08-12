import { Module } from '@nestjs/common'
import { ExamsService } from './exams.service'
import { ExamsController } from './exams.controller'

// Домен «Экзамены и сессия» (docs/ACADEMIC_CORE.md, задача 11).
@Module({
  controllers: [ExamsController],
  providers: [ExamsService],
  exports: [ExamsService],
})
export class ExamsModule {}
