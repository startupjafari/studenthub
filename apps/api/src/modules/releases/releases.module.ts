import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module'
import { ReleasesController } from './releases.controller'
import { ReleasesService } from './releases.service'

// Релизы (docs/RELEASE.md): отметка о прочтении окна «Что нового».
// UsersModule — ради даты регистрации: таблица users принадлежит ему (BACKEND_RULES §2.1).
@Module({
  imports: [UsersModule],
  controllers: [ReleasesController],
  providers: [ReleasesService],
  exports: [ReleasesService],
})
export class ReleasesModule {}
