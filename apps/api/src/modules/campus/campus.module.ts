import { Module } from '@nestjs/common'
import { CampusController } from './campus.controller'
import { CampusService } from './campus.service'
import { CampusPublishService } from './campus-publish.service'

// Кампус — Campus 3D Builder (docs/CAMPUS_BUILDER.md, Фаза 22). Геометрия и проверки — в
// @studenthub/campus-core (тот же код, что у редактора); здесь — права, ревизии, публикация.
@Module({
  controllers: [CampusController],
  providers: [CampusService, CampusPublishService],
  exports: [CampusPublishService],
})
export class CampusModule {}
