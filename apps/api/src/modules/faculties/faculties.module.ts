import { Module } from '@nestjs/common'
import { InvitesModule } from '../invites/invites.module'
import { UniversitiesModule } from '../universities/universities.module'
import { UsersModule } from '../users/users.module'
import { FacultyService } from './faculties.service'
import { FacultiesController } from './faculties.controller'

// UniversitiesModule — для UniversityService (сброс кэша stats при изменении факультетов).
// InvitesModule — отзыв ожидающих приглашений на удаляемый факультет.
// UsersModule — удалённые аккаунты отвязываются от удаляемого факультета.
@Module({
  imports: [UniversitiesModule, InvitesModule, UsersModule],
  controllers: [FacultiesController],
  providers: [FacultyService],
  exports: [FacultyService],
})
export class FacultiesModule {}
