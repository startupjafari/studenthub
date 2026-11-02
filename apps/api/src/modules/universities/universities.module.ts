import { Module } from '@nestjs/common'
import { InvitesModule } from '../invites/invites.module'
import { CareerModule } from '../career/career.module'
import { FilesModule } from '../files/files.module'
import { UniversityService } from './universities.service'
import { UniversityAccessService } from './university-access.service'
import { UniversitiesController } from './universities.controller'
import { UniversityPageService } from './university-page.service'
import { UniversityPageController } from './university-page.controller'

// PrismaModule, RedisModule, AuditModule — глобальные. Экспорт сервиса для Faculties/Groups (5.3–5.4).
// UniversityAccessService — для AuthModule: допуск пользователей по статусу вуза.
// InvitesModule — отзыв ожидающих приглашений при удалении вуза.
// CareerModule — кто видит страницу вуза (свои, платформа, компании с допуском); FilesModule —
// логотип и обложка страницы. Кольца нет: CareerModule импортирует только FilesModule.
@Module({
  imports: [InvitesModule, CareerModule, FilesModule],
  controllers: [UniversitiesController, UniversityPageController],
  providers: [UniversityService, UniversityAccessService, UniversityPageService],
  exports: [UniversityService, UniversityAccessService],
})
export class UniversitiesModule {}
