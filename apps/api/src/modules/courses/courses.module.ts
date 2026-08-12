import { Module } from '@nestjs/common'
import { CoursesService } from './courses.service'
import { CoursesController } from './courses.controller'
import { SubjectsController } from './subjects.controller'
import { TermsController } from './terms.controller'

// Домен «Дисциплины» (docs/ACADEMIC_CORE.md, задача 2): Subject/Term (справочники вуза)
// + Course (дисциплина группы в семестре). Один сервис на три контроллера-ресурса.
@Module({
  controllers: [CoursesController, SubjectsController, TermsController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
