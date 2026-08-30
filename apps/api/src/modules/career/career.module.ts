import { Module } from '@nestjs/common'
import { CareerAccessService } from './career-access.service'
import { CompaniesService } from './companies.service'
import { CompaniesController } from './companies.controller'
import { UniversityCompaniesController } from './university-companies.controller'

// Карьера (Фаза 18). Пока — контур работодателя: компания, её допуск к вузам и очередь
// модерации у карьерного центра. Вакансии, отклики и резюме добавляются следующими
// под-фазами в этот же модуль.
@Module({
  controllers: [CompaniesController, UniversityCompaniesController],
  providers: [CompaniesService, CareerAccessService],
  // CareerAccessService понадобится всем будущим карьерным сервисам, которые читают
  // данные студентов, — экспортируем сразу.
  exports: [CareerAccessService],
})
export class CareerModule {}
