import { Module } from '@nestjs/common'
import { UniversityService } from './universities.service'
import { UniversityAccessService } from './university-access.service'
import { UniversitiesController } from './universities.controller'

// PrismaModule, RedisModule, AuditModule — глобальные. Экспорт сервиса для Faculties/Groups (5.3–5.4).
// UniversityAccessService — для AuthModule: допуск пользователей по статусу вуза.
@Module({
  controllers: [UniversitiesController],
  providers: [UniversityService, UniversityAccessService],
  exports: [UniversityService, UniversityAccessService],
})
export class UniversitiesModule {}
