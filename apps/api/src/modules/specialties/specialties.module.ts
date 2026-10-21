import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module'
import { SpecialtiesService } from './specialties.service'
import { SpecialtiesController } from './specialties.controller'

// Справочник специальностей вуза (Ф-профиль). PrismaService/AuditService — глобальные.
// UsersModule — переименование специальности доходит до учебных данных студентов
// (таблицей пользователей владеет он). Обратной зависимости нет: проверку значения по
// справочнику UserService берёт функцией из specialty-name.ts.
@Module({
  imports: [UsersModule],
  controllers: [SpecialtiesController],
  providers: [SpecialtiesService],
  exports: [SpecialtiesService],
})
export class SpecialtiesModule {}
