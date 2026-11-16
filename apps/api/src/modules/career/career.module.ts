import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { CareerAccessService } from './career-access.service'
import { CareerNotifier } from './career-notifier'
import { CompaniesService } from './companies.service'
import { CompaniesController } from './companies.controller'
import { CompanyMembersService } from './company-members.service'
import { CompanyMembersController } from './company-members.controller'
import { CompanyPageService } from './company-page.service'
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
import { CareerAnalyticsService } from './career-analytics.service'
import { CareerReportService } from './career-report.service'
import { CareerAnalyticsController } from './career-analytics.controller'
import { CareerEventsService } from './career-events.service'
import { CareerEventsController } from './career-events.controller'

// Карьера (Фаза 18). Пока — контур работодателя: компания, её допуск к вузам и очередь
// модерации у карьерного центра. Вакансии, отклики и резюме добавляются следующими
// под-фазами в этот же модуль.
//
// FilesModule — логотип и обложка страницы компании (FileService). Кольца нет: FilesModule
// сам ничего не импортирует, а модули контента (посты, опросы, профиль) тянут CareerModule,
// не наоборот.
@Module({
  imports: [FilesModule],
  controllers: [
    CompaniesController,
    // Команда компании (21.D2): участники и приглашения коллег.
    CompanyMembersController,
    UniversityCompaniesController,
    CareerProfileController,
    VacanciesController,
    EmployerVacanciesController,
    UniversityVacanciesController,
    ApplicationsController,
    EmployerApplicationsController,
    ResumeController,
    CareerAnalyticsController,
    CareerEventsController,
  ],
  providers: [
    CompaniesService,
    CompanyMembersService,
    CompanyPageService,
    CareerAccessService,
    // Уведомления сторонам карьеры: вузу о заявке компании, компании о решениях и откликах.
    CareerNotifier,
    CareerProfileService,
    VacanciesService,
    ApplicationsService,
    ResumeService,
    CareerAnalyticsService,
    CareerReportService,
    CareerEventsService,
  ],
  // CareerAccessService понадобится всем будущим карьерным сервисам, которые читают
  // данные студентов, — экспортируем сразу. CompaniesService — для cron истечения допусков и
  // уборки неподтверждённых компаний (расписание живёт в CleanupModule, логика — здесь) и
  // для AuthModule: вход работодателя ждёт подтверждения почты компании. CompanyMembersService —
  // тоже для AuthModule: регистрация по приглашению в компанию выдаёт сессию там (21.D2).
  exports: [CareerAccessService, CareerProfileService, CompaniesService, CompanyMembersService],
})
export class CareerModule {}
