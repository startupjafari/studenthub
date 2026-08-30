import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { VacanciesService } from './vacancies.service'
import { VacancyInputDto } from './dto/vacancy-input.dto'
import { UpdateVacancyDto } from './dto/update-vacancy.dto'
import { VacancySearchDto } from './dto/vacancy-search.dto'
import { DecideVacancyDto } from './dto/decide-vacancy.dto'
import { CompanyListQueryDto } from './dto/company-list-query.dto'
import { VacancyReviewQueueDto } from './dto/vacancy-review-queue.dto'

@ApiTags('Карьера — вакансии')
@ApiBearerAuth()
@Controller('career/vacancies')
export class VacanciesController {
  constructor(private readonly vacancies: VacanciesService) {}

  // ── Студент ────────────────────────────────────────────────────────────────

  @Get()
  @Roles(Role.STUDENT, Role.STAROSTA, Role.TEACHER, Role.DEAN)
  @ApiOperation({ summary: 'Вакансии, одобренные вашим университетом, с процентом совпадения' })
  @ApiResponse({ status: 200, description: 'Страница вакансий' })
  search(@CurrentUser() user: CurrentUserData, @Query() query: VacancySearchDto) {
    return this.vacancies.search(user, query)
  }

  @Get(':id')
  @Roles(Role.STUDENT, Role.STAROSTA, Role.TEACHER, Role.DEAN)
  @ApiOperation({ summary: 'Карточка вакансии' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — вакансия недоступна вашему вузу' })
  byId(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.vacancies.byIdForStudent(user, id)
  }
}

@ApiTags('Карьера — вакансии компании')
@ApiBearerAuth()
@Controller('career/employer/vacancies')
export class EmployerVacanciesController {
  constructor(private readonly vacancies: VacanciesService) {}

  @Get()
  @Roles(Role.EMPLOYER)
  @ApiOperation({ summary: 'Вакансии своей компании со статусами модерации по вузам' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: CompanyListQueryDto) {
    return this.vacancies.listMine(user, query.page, query.limit)
  }

  @Post()
  @Roles(Role.EMPLOYER)
  @ApiOperation({ summary: 'Создать вакансию (черновик)' })
  @ApiResponse({ status: 201, description: 'Черновик создан' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: VacancyInputDto,
    @Req() req: FastifyRequest,
  ) {
    return this.vacancies.create(user, dto, this.ctx(req))
  }

  @Patch(':id')
  @Roles(Role.EMPLOYER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Изменить вакансию' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateVacancyDto,
    @Req() req: FastifyRequest,
  ) {
    return this.vacancies.update(user, id, dto, this.ctx(req))
  }

  @Post(':id/publish')
  @Roles(Role.EMPLOYER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Опубликовать: уходит на модерацию во все допустившие вузы' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — нет вузов с открытым доступом' })
  publish(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.vacancies.publish(user, id, this.ctx(req))
  }

  @Post(':id/pause')
  @Roles(Role.EMPLOYER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Снять с публикации' })
  pause(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Req() req: FastifyRequest) {
    return this.vacancies.setStatus(user, id, 'PAUSED', this.ctx(req))
  }

  @Post(':id/close')
  @Roles(Role.EMPLOYER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Закрыть вакансию' })
  close(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Req() req: FastifyRequest) {
    return this.vacancies.setStatus(user, id, 'CLOSED', this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}

@ApiTags('Карьера — модерация вакансий (вуз)')
@ApiBearerAuth()
@Controller('career/university/vacancies')
export class UniversityVacanciesController {
  constructor(private readonly vacancies: VacanciesService) {}

  @Get()
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR, Role.DEAN)
  @ApiOperation({ summary: 'Вакансии на модерации в своём университете' })
  queue(@CurrentUser() user: CurrentUserData, @Query() query: VacancyReviewQueueDto) {
    return this.vacancies.reviewQueue(user, query.status, query.page, query.limit)
  }

  @Patch(':id')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Решение по вакансии: показать студентам или отклонить' })
  decide(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: DecideVacancyDto,
    @Req() req: FastifyRequest,
  ) {
    return this.vacancies.decide(user, id, dto, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
