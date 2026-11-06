import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RestrictedAllowed } from '../../common/decorators/restricted-allowed.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { LibraryReservationsService } from './library-reservations.service'
import { ReservationListQueryDto } from './dto/reservation-list-query.dto'

// Брони библиотеки (docs/PROJECT.md §3.11): читатель бронирует и отменяет свои брони;
// библиотекарь видит полку броней и очередь, может снять бронь.
@ApiTags('Библиотека')
@ApiBearerAuth()
@RestrictedAllowed(Role.LIBRARIAN)
@Controller('library')
export class LibraryReservationsController {
  constructor(private readonly reservations: LibraryReservationsService) {}

  @Post('books/:id/reservations')
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiOperation({ summary: 'Забронировать книгу: свободный экземпляр — сразу, иначе в очередь' })
  @ApiResponse({
    status: 409,
    description:
      'details.field: status | overdue — читателю нельзя; reservationLimit | alreadyReserved | alreadyBorrowed | noCopies; module',
  })
  reserve(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.reservations.reserve(user, id, this.ctx(req))
  }

  @Get('me/reservations')
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiOperation({ summary: 'Мои брони: готовые, в очереди, недавняя история' })
  mine(@CurrentUser() user: CurrentUserData) {
    return this.reservations.mine(user)
  }

  @Post('me/reservations/:id/cancel')
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiOperation({ summary: 'Отменить свою бронь' })
  @ApiResponse({ status: 409, description: 'details.field = closed — бронь уже закрыта' })
  cancelMine(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.reservations.cancelMine(user, id, this.ctx(req))
  }

  @Get('reservations')
  @Roles(Role.LIBRARIAN, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Брони вуза: полка броней, очередь, закрытые' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: ReservationListQueryDto) {
    return this.reservations.list(user, query)
  }

  @Post('reservations/:id/cancel')
  @Roles(Role.LIBRARIAN)
  @ApiOperation({ summary: 'Снять бронь читателя' })
  @ApiResponse({ status: 409, description: 'details.field = closed — бронь уже закрыта' })
  cancel(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.reservations.cancelByStaff(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
