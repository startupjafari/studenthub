import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { AssignmentsService } from './assignments.service'
import { AssignmentsController } from './assignments.controller'
import { SubmissionsController } from './submissions.controller'

// Домен «Задания» (docs/ACADEMIC_CORE.md, задача 3): Assignment + Submission поверх Course.
// Файлы сдач — бакет applications через FileService.
@Module({
  imports: [FilesModule],
  controllers: [AssignmentsController, SubmissionsController],
  providers: [AssignmentsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
