import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { FastifyRequest } from 'fastify'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RestrictedAllowed } from '../../common/decorators/restricted-allowed.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { CampusService } from './campus.service'
import { CampusPublishService } from './campus-publish.service'
import { CampusCreateCampusDto } from './dto/create-campus.dto'
import { CampusUpdateCampusDto } from './dto/update-campus.dto'
import { CampusCreateBuildingDto } from './dto/create-building.dto'
import { CampusUpdateBuildingDto } from './dto/update-building.dto'
import { CampusCreateFloorDto } from './dto/create-floor.dto'
import { CampusUpdateFloorDto } from './dto/update-floor.dto'
import { CampusSaveFloorPlanDto } from './dto/save-floor-plan.dto'
import { CampusSaveSitePlanDto } from './dto/save-site-plan.dto'
import { CampusPublishDto } from './dto/publish.dto'
import { CampusSearchDto } from './dto/search.dto'
import { CampusPresenceDto } from './dto/presence.dto'

const EDITORS = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR] as const

/**
 * Кампус — Campus 3D Builder (docs/CAMPUS_BUILDER.md §18). Правка — админ и модератор вуза
 * (+ платформа), чтение опубликованного — члены вуза и охрана. Права перепроверяет сервис:
 * роль — здесь, принадлежность вузу — там.
 *
 * Статические пути (`search`, `rooms/…`, `buildings/…`, `floors/…`) объявлены до `:id`.
 */
@ApiTags('Кампус')
@ApiBearerAuth()
@Controller('campus')
export class CampusController {
  constructor(
    private readonly campus: CampusService,
    private readonly publishing: CampusPublishService,
  ) {}

  // ── Зрителю ───────────────────────────────────────────────────────────────────────

  @RestrictedAllowed(Role.SECURITY_GUARD)
  @Get('search')
  @ApiOperation({ summary: 'Поиск помещений по номеру и названию в опубликованных картах вуза' })
  search(@CurrentUser() user: CurrentUserData, @Query() query: CampusSearchDto) {
    return this.publishing.search(user, query)
  }

  @RestrictedAllowed(Role.SECURITY_GUARD)
  @Get('rooms/:roomId/location')
  @ApiOperation({ summary: 'Где помещение вуза на карте (мост из расписания и QR)' })
  @ApiResponse({ status: 404, description: 'Помещения нет на опубликованной карте' })
  roomLocation(@CurrentUser() user: CurrentUserData, @Param('roomId') roomId: string) {
    return this.publishing.roomLocation(user, roomId)
  }

  @RestrictedAllowed(Role.SECURITY_GUARD)
  @Get()
  @ApiOperation({ summary: 'Кампусы вуза: редактору — все, зрителю — опубликованные' })
  list(@CurrentUser() user: CurrentUserData, @Query('universityId') universityId?: string) {
    return this.campus.list(user, universityId)
  }

  @RestrictedAllowed(Role.SECURITY_GUARD)
  @Get(':id/published')
  @ApiOperation({ summary: 'Опубликованная карта: манифест текущей версии' })
  published(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.publishing.published(user, id)
  }

  @RestrictedAllowed(Role.SECURITY_GUARD)
  @Get(':id/published/floors/:floorId')
  @ApiOperation({ summary: 'Этаж опубликованной версии, очищенный под уровень зрителя' })
  publishedFloor(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('floorId') floorId: string,
  ) {
    return this.publishing.publishedFloor(user, id, floorId)
  }

  @RestrictedAllowed(Role.SECURITY_GUARD)
  @Get(':id/published/nav')
  @ApiOperation({ summary: 'Навигационный граф текущей версии под уровень зрителя' })
  publishedNav(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.publishing.publishedNav(user, id)
  }

  // ── Кампус ────────────────────────────────────────────────────────────────────────

  @Post()
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'Создать кампус' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CampusCreateCampusDto,
    @Req() req: FastifyRequest,
  ) {
    return this.campus.create(user, dto, this.ctx(req))
  }

  @Get(':id')
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'Кампус для редактора: корпуса, этажи, ревизии планов' })
  tree(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.campus.tree(user, id)
  }

  @Patch(':id')
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'Изменить кампус' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CampusUpdateCampusDto,
  ) {
    return this.campus.update(user, id, dto)
  }

  @Delete(':id')
  @Roles(...EDITORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить кампус (мягко)' })
  remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.campus.remove(user, id, this.ctx(req))
  }

  @Get(':id/site')
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'Территория (черновик)' })
  site(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.campus.getSite(user, id)
  }

  @Put(':id/site')
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'Сохранить территорию (ревизия — 409 при чужой правке)' })
  saveSite(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CampusSaveSitePlanDto,
  ) {
    return this.campus.saveSite(user, id, dto)
  }

  @Post(':id/publish')
  @Roles(...EDITORS)
  @Throttle({ default: { limit: 2, ttl: 30_000 } })
  @ApiOperation({ summary: 'Опубликовать карту: проверка всех этажей, новая версия' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — список проблем в details' })
  @ApiResponse({ status: 409, description: 'CONFLICT — план изменился после проверки' })
  publish(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CampusPublishDto,
    @Req() req: FastifyRequest,
  ) {
    return this.publishing.publish(user, id, dto, this.ctx(req))
  }

  @Get(':id/versions')
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'История публикаций' })
  versions(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.publishing.versions(user, id)
  }

  @Post(':id/versions/:versionId/activate')
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'Откат публикации на версию' })
  activate(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.publishing.activate(user, id, versionId, this.ctx(req))
  }

  @Post(':id/versions/:versionId/restore')
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'Восстановить черновики из версии (прежние — в снимки)' })
  restore(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.publishing.restoreToDraft(user, id, versionId, this.ctx(req))
  }

  // ── Корпуса ───────────────────────────────────────────────────────────────────────

  @Post(':id/buildings')
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'Добавить корпус с этажами (этажи — с наружными стенами по контуру)' })
  createBuilding(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CampusCreateBuildingDto,
    @Req() req: FastifyRequest,
  ) {
    return this.campus.createBuilding(user, id, dto, this.ctx(req))
  }

  @Patch('buildings/:buildingId')
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'Изменить корпус' })
  updateBuilding(
    @CurrentUser() user: CurrentUserData,
    @Param('buildingId') id: string,
    @Body() dto: CampusUpdateBuildingDto,
  ) {
    return this.campus.updateBuilding(user, id, dto)
  }

  @Delete('buildings/:buildingId')
  @Roles(...EDITORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить корпус (мягко)' })
  removeBuilding(
    @CurrentUser() user: CurrentUserData,
    @Param('buildingId') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.campus.removeBuilding(user, id, this.ctx(req))
  }

  @Post('buildings/:buildingId/floors')
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'Добавить этаж (пустой по контуру или копия этажа)' })
  @ApiResponse({ status: 409, description: 'CONFLICT — уровень занят' })
  createFloor(
    @CurrentUser() user: CurrentUserData,
    @Param('buildingId') id: string,
    @Body() dto: CampusCreateFloorDto,
  ) {
    return this.campus.createFloor(user, id, dto)
  }

  // ── Этажи и планы ─────────────────────────────────────────────────────────────────

  @Patch('floors/:floorId')
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'Изменить этаж' })
  updateFloor(
    @CurrentUser() user: CurrentUserData,
    @Param('floorId') id: string,
    @Body() dto: CampusUpdateFloorDto,
  ) {
    return this.campus.updateFloor(user, id, dto)
  }

  @Delete('floors/:floorId')
  @Roles(...EDITORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить этаж' })
  removeFloor(
    @CurrentUser() user: CurrentUserData,
    @Param('floorId') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.campus.removeFloor(user, id, this.ctx(req))
  }

  @Get('floors/:floorId/plan')
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'План этажа (черновик) с ревизией' })
  plan(@CurrentUser() user: CurrentUserData, @Param('floorId') id: string) {
    return this.campus.getPlan(user, id)
  }

  @Put('floors/:floorId/plan')
  @Roles(...EDITORS)
  @ApiOperation({ summary: 'Сохранить план этажа (до 2 МиБ; 409 при чужой правке)' })
  @ApiResponse({ status: 409, description: 'CONFLICT — details[0].message = текущая ревизия' })
  savePlan(
    @CurrentUser() user: CurrentUserData,
    @Param('floorId') id: string,
    @Body() dto: CampusSaveFloorPlanDto,
  ) {
    return this.campus.savePlan(user, id, dto)
  }

  @Post('floors/:floorId/presence')
  @Roles(...EDITORS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Кто правит этаж: сердцебиение мягкой блокировки' })
  presence(
    @CurrentUser() user: CurrentUserData,
    @Param('floorId') id: string,
    @Body() dto: CampusPresenceDto,
  ) {
    return this.campus.presence(user, id, dto.force ?? false)
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
