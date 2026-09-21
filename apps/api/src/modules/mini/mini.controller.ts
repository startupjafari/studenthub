import { Body, Controller, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Public } from '../../common/decorators/public.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { MiniService } from './mini.service'
import { MiniSessionDto } from './dto/mini-session.dto'
import { MiniLinkDto } from './dto/mini-link.dto'

// Вход в админский мини-апп (docs/PROJECT.md §8.3).
//
// Два публичных маршрута — вынужденно: Telegram открывает мини-апп без нашего JWT, и
// предъявить в первом запросе человеку нечего, кроме подписанного initData. Отсюда
// строгий троттлер, одинаковый ответ на любой отказ и отсутствие каких-либо действий
// над платформой в этих маршрутах: они только обменивают подпись на короткий токен.

@ApiTags('Мини-апп')
@Controller('mini')
export class MiniController {
  constructor(private readonly mini: MiniService) {}

  @Post('link-code')
  @ApiBearerAuth()
  @Roles(Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR)
  // Код — пропуск к админскому доступу: десять штук в час хватит любому живому человеку,
  // а перебор по чужому аккаунту делает бессмысленным.
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  @ApiOperation({ summary: 'Одноразовый код для привязки Telegram (из веба)' })
  @ApiResponse({ status: 201, description: 'Код выдан, живёт 5 минут' })
  linkCode(@CurrentUser() user: CurrentUserData) {
    return this.mini.issueLinkCode(user.sub, user.role)
  }

  @Public()
  @Post('link')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Привязать Telegram по коду из веба' })
  @ApiResponse({ status: 201, description: 'Привязано, выдан токен мини-аппа' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — код неверен или истёк' })
  @ApiResponse({ status: 409, description: 'CONFLICT — Telegram привязан к другому аккаунту' })
  link(@Body() dto: MiniLinkDto) {
    return this.mini.link(dto.initData, dto.code)
  }

  @Public()
  @Post('session')
  // Мини-апп обновляет токен при каждом открытии и по истечении 15 минут; 30 в минуту —
  // с запасом на переоткрытия, но не на перебор подписей.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Обменять initData на короткий токен мини-аппа' })
  @ApiResponse({ status: 201, description: 'Токен на 15 минут' })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED — подпись, привязка или роль' })
  session(@Body() dto: MiniSessionDto) {
    return this.mini.session(dto.initData)
  }
}
