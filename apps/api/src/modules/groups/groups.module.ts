import { Module } from '@nestjs/common'
import { InvitesModule } from '../invites/invites.module'
import { UniversitiesModule } from '../universities/universities.module'
import { UsersModule } from '../users/users.module'
import { GroupService } from './groups.service'
import { GroupsController } from './groups.controller'

// UniversitiesModule — для сброса кэша stats вуза при изменении групп. UsersModule — роль
// старосты: таблицей пользователей владеет он. InvitesModule — отзыв ожидающих приглашений
// в удаляемую группу.
@Module({
  imports: [UniversitiesModule, UsersModule, InvitesModule],
  controllers: [GroupsController],
  providers: [GroupService],
  exports: [GroupService],
})
export class GroupsModule {}
