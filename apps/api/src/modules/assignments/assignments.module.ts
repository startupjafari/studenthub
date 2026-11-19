import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { AssignmentEvents } from './assignment-events'
import { AssignmentsService } from './assignments.service'
import { AssignmentsController } from './assignments.controller'
import { SubmissionsController } from './submissions.controller'

// Домен «Задания» (docs/ACADEMIC_CORE.md, задача 3): Assignment + Submission поверх Course.
// Файлы сдач — бакет applications через FileService. AssignmentEvents — живые сигналы
// `assignment.changed` (RealtimeModule глобальный, импорт не нужен).
@Module({
  imports: [FilesModule],
  controllers: [AssignmentsController, SubmissionsController],
  providers: [AssignmentsService, AssignmentEvents],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
