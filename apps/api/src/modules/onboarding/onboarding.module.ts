import { Module } from '@nestjs/common'
import { InvitesModule } from '../invites/invites.module'
import { UniversitiesModule } from '../universities/universities.module'
import { DemoRequestsController } from './demo-requests.controller'
import { DemoRequestsService } from './demo-requests.service'
import { OnboardingController } from './onboarding.controller'
import { OnboardingService } from './onboarding.service'

// Приход вуза на платформу (docs/PROJECT.md §31): заявка снаружи, решение модератора
// платформы, мастер первичной настройки внутри.
//
// InvitesModule — потому что одобрение выдаёт обычное приглашение, а не свой механизм
// доступа: правило «внутрь только по приглашению» этой функцией не обходится.
@Module({
  imports: [InvitesModule, UniversitiesModule],
  controllers: [DemoRequestsController, OnboardingController],
  providers: [DemoRequestsService, OnboardingService],
  // DemoRequestsService экспортируется ради уборки неподтверждённых заявок кроном:
  // таблицу чистит её владелец, планировщик только зовёт (§2.1).
  exports: [OnboardingService, DemoRequestsService],
})
export class OnboardingModule {}
