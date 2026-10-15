import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { CatalogService } from './catalog.service'
import { CatalogAdminService } from './catalog-admin.service'
import { UpsertApplicationServiceDto } from './dto/upsert-application-service.dto'
import { ManagedServicesQueryDto } from './dto/managed-services-query.dto'

// Каталог услуг университета (доступен всем авторизованным — студент выбирает услугу).
// Управление каталогом — админ вуза (услуги вуза) и админ платформы (глобальные шаблоны);
// права и scope проверяет CatalogAdminService через ApplicationPolicy ('manage-services').
@ApiTags('Услуги университета')
@ApiBearerAuth()
@Controller()
export class ApplicationServicesController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly admin: CatalogAdminService,
  ) {}

  @Get('application-categories')
  @ApiOperation({ summary: 'Каталог: категории с доступными услугами (экран выбора услуги)' })
  categories(@CurrentUser() user: CurrentUserData) {
    return this.catalog.listCategories(user)
  }

  // ── Управление каталогом ────────────────────────────────────────────────────
  // Статические пути объявлены до `application-services/:id`, но и порядок здесь не важен:
  // роутер Fastify ставит статический сегмент выше параметра.

  @Get('application-categories/manage')
  @Roles(Role.UNIVERSITY_ADMIN, Role.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Все активные категории — для формы услуги' })
  manageCategories(@CurrentUser() user: CurrentUserData) {
    return this.admin.listCategories(user)
  }

  @Get('application-services/manage')
  @Roles(Role.UNIVERSITY_ADMIN, Role.PLATFORM_ADMIN)
  @ApiOperation({
    summary:
      'Услуги для управления: свои услуги вуза и шаблоны платформы (у админа платформы — шаблоны)',
  })
  manageList(@CurrentUser() user: CurrentUserData, @Query() query: ManagedServicesQueryDto) {
    return this.admin.list(user, query)
  }

  @Get('application-services/manage/:id')
  @Roles(Role.UNIVERSITY_ADMIN, Role.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Услуга для редактора: требования и поля формы, признак editable' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — услуга другого вуза или не существует' })
  manageGet(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.admin.get(user, id)
  }

  @Post('application-services')
  @Roles(Role.UNIVERSITY_ADMIN, Role.PLATFORM_ADMIN)
  @ApiOperation({
    summary: 'Создать услугу: у админа вуза — в своём вузе, у админа платформы — шаблон',
  })
  @ApiResponse({ status: 201, description: 'Создано: { id }' })
  @ApiResponse({ status: 409, description: 'CONFLICT — код уже занят' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpsertApplicationServiceDto,
    @Req() req: FastifyRequest,
  ) {
    return this.admin.create(user, dto, this.ctx(req))
  }

  @Put('application-services/:id')
  @Roles(Role.UNIVERSITY_ADMIN, Role.PLATFORM_ADMIN)
  @ApiOperation({
    summary: 'Сохранить услугу целиком; убранные требования и поля выключаются, а не удаляются',
  })
  @ApiResponse({ status: 200, description: 'Сохранено: { id }' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — шаблон платформы правит только её админ' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpsertApplicationServiceDto,
    @Req() req: FastifyRequest,
  ) {
    return this.admin.update(user, id, dto, this.ctx(req))
  }

  @Post('application-services/:id/customize')
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({
    summary: 'Настроить шаблон для своего вуза: копия с тем же кодом заменяет шаблон',
  })
  @ApiResponse({ status: 201, description: 'Копия создана: { id }' })
  @ApiResponse({ status: 409, description: 'CONFLICT — копия уже есть' })
  customize(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.admin.customize(user, id, this.ctx(req))
  }

  @Get('application-services/:id')
  @ApiOperation({ summary: 'Детали услуги: описание, требования-документы, поля формы' })
  service(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.catalog.getService(id, user)
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
