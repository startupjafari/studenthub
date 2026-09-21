import { Body, Controller, Get, Patch, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Public, MaintenanceExempt } from '../../common/decorators'
import { Roles } from '../../common/decorators/roles.decorator'
import { MiniAllowed } from '../../common/decorators/mini-allowed.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { QueueService } from '../../common/queue'
import { PlatformService } from './platform.service'
import { SetMaintenanceDto } from './dto/set-maintenance.dto'
import { SetBannerDto } from './dto/set-banner.dto'
import { SetSectionsDto } from './dto/set-sections.dto'
import { AnnounceReleaseDto } from './dto/announce-release.dto'
import { SetNotificationsDto } from './dto/set-notifications.dto'

// Состояние платформы: читают все, меняет только платформенный администратор.
//
// Модератора среди пишущих нет намеренно: его работа — разбирать жалобы, а выключатель,
// гасящий продукт для всех, к ней не относится. Все четыре ручки помечены @MiniAllowed() —
// управлять платформой с телефона и есть смысл мини-аппа.
@ApiTags('Платформа')
// Чтение состояния объясняет клиентам, что происходит, а запись — снимает режим.
@MaintenanceExempt()
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly queue: QueueService,
  ) {}

  // Читают все, включая неаутентифицированных: страница логина тоже обязана показать режим
  // техработ — иначе человек будет биться в форму, которая всё равно не пустит. Наружу
  // уходят только объявления, адресованные посетителю; кто двигал рычаги — не публикуется.
  @Get('state')
  @Public()
  @ApiOperation({ summary: 'Режим техработ, баннер, погашенные разделы, объявленный релиз' })
  @ApiResponse({ status: 200, description: 'Действующее состояние платформы' })
  state() {
    return this.platform.publicState()
  }

  @Get('queues')
  @ApiBearerAuth()
  @Roles(Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR)
  @MiniAllowed()
  // Растущее «в ожидании» означает, что воркер не справляется; ненулевое «упало» — что
  // часть работы потеряна молча. Оба числа иначе видны только в логах.
  @ApiOperation({ summary: 'Размеры очередей: сколько задач ждёт и сколько упало' })
  queues() {
    return this.queue.counts()
  }

  @Patch('maintenance')
  @ApiBearerAuth()
  @Roles(Role.PLATFORM_ADMIN)
  @MiniAllowed()
  // Лимит бьёт по подбору кода 2FA: остановка платформы — не то действие, к которому
  // стоит подпускать перебор.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Включить (нужен код 2FA) или снять режим техработ' })
  @ApiResponse({ status: 200, description: 'Новое состояние' })
  @ApiResponse({ status: 401, description: 'INVALID_2FA_CODE — нет кода или он неверный' })
  setMaintenance(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SetMaintenanceDto,
    @Req() req: FastifyRequest,
  ) {
    return this.platform.setMaintenance(user.sub, dto, this.ctx(req))
  }

  @Patch('banner')
  @ApiBearerAuth()
  @Roles(Role.PLATFORM_ADMIN)
  @MiniAllowed()
  @ApiOperation({ summary: 'Повесить или снять баннер-объявление' })
  @ApiResponse({ status: 200, description: 'Новое состояние' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR — баннер без текста' })
  setBanner(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SetBannerDto,
    @Req() req: FastifyRequest,
  ) {
    return this.platform.setBanner(user.sub, dto, this.ctx(req))
  }

  @Patch('sections')
  @ApiBearerAuth()
  @Roles(Role.PLATFORM_ADMIN)
  @MiniAllowed()
  @ApiOperation({ summary: 'Погасить или вернуть разделы (список приходит целиком)' })
  @ApiResponse({ status: 200, description: 'Новое состояние' })
  setSections(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SetSectionsDto,
    @Req() req: FastifyRequest,
  ) {
    return this.platform.setSections(user.sub, dto, this.ctx(req))
  }

  @Patch('notifications')
  @ApiBearerAuth()
  @Roles(Role.PLATFORM_ADMIN)
  @MiniAllowed()
  @ApiOperation({ summary: 'Уведомления команде: тихие часы, дежурный, виды, час сводки' })
  setNotifications(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SetNotificationsDto,
    @Req() req: FastifyRequest,
  ) {
    return this.platform.setNotifications(user.sub, dto, this.ctx(req))
  }

  @Patch('release')
  @ApiBearerAuth()
  @Roles(Role.PLATFORM_ADMIN)
  @MiniAllowed()
  @ApiOperation({ summary: 'Объявить версию «Что нового» (только номер)' })
  @ApiResponse({ status: 200, description: 'Новое состояние' })
  announceRelease(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: AnnounceReleaseDto,
    @Req() req: FastifyRequest,
  ) {
    return this.platform.announceRelease(user.sub, dto, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
