import { Module } from '@nestjs/common'
import { GradebookService } from './gradebook.service'
import { GradebookController } from './gradebook.controller'

// Домен «Журнал оценок» (docs/ACADEMIC_CORE.md, задача 7): колонки-контрольные + оценки.
@Module({
  controllers: [GradebookController],
  providers: [GradebookService],
  exports: [GradebookService],
})
export class GradebookModule {}
