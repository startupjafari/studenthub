import { Module } from '@nestjs/common'
import { UniversityService } from './universities.service'
import { UniversitiesController } from './universities.controller'

// PrismaModule, RedisModule, AuditModule — глобальные. Экспорт сервиса для Faculties/Groups (5.3–5.4).
@Module({
  controllers: [UniversitiesController],
  providers: [UniversityService],
  exports: [UniversityService],
})
export class UniversitiesModule {}
