import { Module } from '@nestjs/common'
import { AnalyticsModule } from '../analytics/analytics.module'
import { InvitesModule } from '../invites/invites.module'
import { UniversitiesModule } from '../universities/universities.module'
import { UsersModule } from '../users/users.module'
import { GroupService } from './groups.service'
import { GroupsController } from './groups.controller'

// UniversitiesModule — для сброса кэша stats вуза при изменении групп, AnalyticsModule — для
// сброса кэша обзора факультета на тех же событиях. UsersModule — роль старосты: таблицей
// пользователей владеет он. InvitesModule — отзыв ожидающих приглашений в удаляемую группу.
@Module({
  imports: [UniversitiesModule, UsersModule, InvitesModule, AnalyticsModule],
  controllers: [GroupsController],
  providers: [GroupService],
  exports: [GroupService],
})
export class GroupsModule {}
