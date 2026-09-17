import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { ReleasesService } from './releases.service'
import { MarkReleaseSeenDto } from './dto/mark-release-seen.dto'

// «Что нового»: пользователь читает и пишет только свою отметку — userId берётся из JWT,
// в запросе его нет и быть не может. Доступно любой аутентифицированной роли.
@ApiTags('Релизы')
@ApiBearerAuth()
@Controller('releases')
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get('me')
  @ApiOperation({ summary: 'До какой версии «Что нового» пользователь дочитал' })
  state(@CurrentUser() user: CurrentUserData) {
    return this.releases.state(user.sub)
  }

  @Post('seen')
  @ApiOperation({ summary: 'Отметить версию «Что нового» прочитанной' })
  markSeen(@CurrentUser() user: CurrentUserData, @Body() dto: MarkReleaseSeenDto) {
    return this.releases.markSeen(user.sub, dto)
  }
}
