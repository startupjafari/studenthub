import { Module } from '@nestjs/common'
import { UniversitiesModule } from '../universities/universities.module'
import { FacultyService } from './faculties.service'
import { FacultiesController } from './faculties.controller'

// UniversitiesModule — для UniversityService (сброс кэша stats при изменении факультетов).
@Module({
  imports: [UniversitiesModule],
  controllers: [FacultiesController],
  providers: [FacultyService],
  exports: [FacultyService],
})
export class FacultiesModule {}
