import { Module } from '@nestjs/common'
import { AssignmentsService } from './assignments.service'
import { AssignmentsController } from './assignments.controller'
import { SubmissionsController } from './submissions.controller'

// Домен «Задания» (docs/ACADEMIC_CORE.md, задача 3): Assignment + Submission поверх Course.
@Module({
  controllers: [AssignmentsController, SubmissionsController],
  providers: [AssignmentsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
