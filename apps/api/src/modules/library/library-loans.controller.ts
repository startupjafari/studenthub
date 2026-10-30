import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RestrictedAllowed } from '../../common/decorators/restricted-allowed.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { LibraryLoansService } from './library-loans.service'
import { IssueLoanDto } from './dto/issue-loan.dto'
import { LoanListQueryDto } from './dto/loan-list-query.dto'
import { ResolveReaderDto } from './dto/resolve-reader.dto'
import { ReturnLoanDto } from './dto/return-loan.dto'
import { RenewLoanDto } from './dto/renew-loan.dto'
import { CancelLoanDto } from './dto/cancel-loan.dto'
import { CancelReturnDto } from './dto/cancel-return.dto'

// Выдачи библиотеки (docs/PROJECT.md §3.11). Выдаёт и принимает библиотекарь; выдачи вуза
// видит и админ; читатель — свои книги и «это не я» по ошибочной выдаче.
@ApiTags('Библиотека')
@ApiBearerAuth()
@RestrictedAllowed(Role.LIBRARIAN)
@Controller('library')
export class LibraryLoansController {
  constructor(private readonly loans: LibraryLoansService) {}

  @Post('readers/resolve')
  @Roles(Role.LIBRARIAN)
  @ApiOperation({
    summary: 'Скан студенческого: читатель, может ли брать книги, пропуск на выдачу',
  })
  @ApiResponse({
    status: 409,
    description: 'QR уже проверил другой сотрудник; библиотека выключена',
  })
  resolve(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ResolveReaderDto,
    @Req() req: FastifyRequest,
  ) {
    return this.loans.resolveReader(user, dto.token, this.ctx(req))
  }

  @Post('loans')
  @Roles(Role.LIBRARIAN)
  @ApiOperation({ summary: 'Выдать экземпляр читателю по пропуску' })
  @ApiResponse({
    status: 409,
    description:
      'details.field: status | overdue | lost | limit — читателю нельзя; onLoan | reserved | withdrawn | archived — экземпляр; ticket — пропуск истёк; module',
  })
  @ApiResponse({ status: 422, description: 'Срок вне правил библиотеки (field = dueDate)' })
  issue(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: IssueLoanDto,
    @Req() req: FastifyRequest,
  ) {
    return this.loans.issue(user, dto, this.ctx(req))
  }

  @Post('returns')
  @Roles(Role.LIBRARIAN)
  @ApiOperation({ summary: 'Принять книгу: скан экземпляра, состояние; очередь броней — отложить' })
  @ApiResponse({ status: 409, description: 'details.field = notOnLoan — экземпляр не выдан' })
  returnCopy(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ReturnLoanDto,
    @Req() req: FastifyRequest,
  ) {
    return this.loans.returnCopy(user, dto, this.ctx(req))
  }

  @Post('loans/:id/renew')
  @Roles(Role.LIBRARIAN)
  @ApiOperation({ summary: 'Продлить выдачу' })
  @ApiResponse({ status: 409, description: 'details.field: renewals | queue | notOnLoan' })
  @ApiResponse({ status: 422, description: 'Срок вне правил (field = dueDate)' })
  renew(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: RenewLoanDto,
    @Req() req: FastifyRequest,
  ) {
    return this.loans.renew(user, id, dto, this.ctx(req))
  }

  @Post('loans/:id/lost')
  @Roles(Role.LIBRARIAN)
  @ApiOperation({
    summary: 'Книга утеряна читателем: выдача закрыта, экземпляр — из оборота, долг за читателем',
  })
  lost(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Req() req: FastifyRequest) {
    return this.loans.markLost(user, id, this.ctx(req))
  }

  @Post('loans/:id/lost/settle')
  @Roles(Role.LIBRARIAN)
  @ApiOperation({ summary: 'Долг по утерянной книге погашен: книгу заменили или возместили' })
  @ApiResponse({ status: 404, description: 'Выдача не найдена или чужого вуза' })
  @ApiResponse({
    status: 409,
    description: 'details.field: notLost — выдача не утеряна; settled — долг уже погашен',
  })
  settleLost(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.loans.settleLost(user, id, this.ctx(req))
  }

  @Post('loans/:id/cancel')
  @Roles(Role.LIBRARIAN)
  @ApiOperation({ summary: 'Отменить ошибочную выдачу с причиной' })
  cancel(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CancelLoanDto,
    @Req() req: FastifyRequest,
  ) {
    return this.loans.cancel(user, id, dto, this.ctx(req))
  }

  @Post('loans/:id/return/cancel')
  @Roles(Role.LIBRARIAN)
  @ApiOperation({
    summary: 'Отменить ошибочный возврат с причиной: выдача снова открыта с прежним сроком',
  })
  @ApiResponse({ status: 404, description: 'Выдача не найдена или чужого вуза' })
  @ApiResponse({
    status: 409,
    description:
      'details.field: notReturned — выдача не закрыта возвратом; returnWindow — прошло больше суток; reissued — экземпляр выдан другому; heldForReservation — отложен под бронь; withdrawn — утерян или списан',
  })
  cancelReturn(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CancelReturnDto,
    @Req() req: FastifyRequest,
  ) {
    return this.loans.cancelReturn(user, id, dto, this.ctx(req))
  }

  @Get('loans')
  @Roles(Role.LIBRARIAN, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Выдачи вуза: на руках, просроченные, закрытые' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: LoanListQueryDto) {
    return this.loans.list(user, query)
  }

  @Get('me/loans')
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiOperation({ summary: 'Мои книги: на руках и история' })
  mine(@CurrentUser() user: CurrentUserData) {
    return this.loans.mine(user)
  }

  @Post('loans/:id/dispute')
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiOperation({ summary: '«Это не я»: читатель отмечает выдачу как ошибочную' })
  @ApiResponse({ status: 404, description: 'Не своя выдача' })
  dispute(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.loans.dispute(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
