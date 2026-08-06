import { Module } from '@nestjs/common'
import { UniversitiesModule } from '../universities/universities.module'
import { GroupService } from './groups.service'
import { GroupsController } from './groups.controller'

// UniversitiesModule — для сброса кэша stats вуза при изменении групп.
@Module({
  imports: [UniversitiesModule],
  controllers: [GroupsController],
  providers: [GroupService],
  exports: [GroupService],
})
export class GroupsModule {}
