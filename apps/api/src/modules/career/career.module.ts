import { Module } from '@nestjs/common'
import { CareerAccessService } from './career-access.service'
import { CompaniesService } from './companies.service'
import { CompaniesController } from './companies.controller'
import { UniversityCompaniesController } from './university-companies.controller'
import { CareerProfileService } from './career-profile.service'
import { CareerProfileController } from './career-profile.controller'
import { VacanciesService } from './vacancies.service'
import {
  VacanciesController,
  EmployerVacanciesController,
  UniversityVacanciesController,
} from './vacancies.controller'
import { ApplicationsService } from './applications.service'
import { ApplicationsController, EmployerApplicationsController } from './applications.controller'
import { ResumeService } from './resume.service'
import { ResumeController } from './resume.controller'

// Карьера (Фаза 18). Пока — контур работодателя: компания, её допуск к вузам и очередь
// модерации у карьерного центра. Вакансии, отклики и резюме добавляются следующими
// под-фазами в этот же модуль.
@Module({
  controllers: [
    CompaniesController,
    UniversityCompaniesController,
    CareerProfileController,
    VacanciesController,
    EmployerVacanciesController,
    UniversityVacanciesController,
    ApplicationsController,
    EmployerApplicationsController,
    ResumeController,
  ],
  providers: [
    CompaniesService,
    CareerAccessService,
    CareerProfileService,
    VacanciesService,
    ApplicationsService,
    ResumeService,
  ],
  // CareerAccessService понадобится всем будущим карьерным сервисам, которые читают
  // данные студентов, — экспортируем сразу.
  exports: [CareerAccessService, CareerProfileService],
})
export class CareerModule {}
