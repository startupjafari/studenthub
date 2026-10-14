import { Module } from '@nestjs/common'
import { UniversitiesModule } from '../universities/universities.module'
import { UsersModule } from '../users/users.module'
import { GroupService } from './groups.service'
import { GroupsController } from './groups.controller'

// UniversitiesModule — для сброса кэша stats вуза при изменении групп. UsersModule — роль
// старосты: таблицей пользователей владеет он.
@Module({
  imports: [UniversitiesModule, UsersModule],
  controllers: [GroupsController],
  providers: [GroupService],
  exports: [GroupService],
})
export class GroupsModule {}
