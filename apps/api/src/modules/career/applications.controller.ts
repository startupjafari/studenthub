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
import { ApplicationsService } from './applications.service'
import { CreateApplicationDto } from './dto/create-application.dto'
import { ChangeApplicationStatusDto } from './dto/change-application-status.dto'
import { ApplicationListQueryDto } from './dto/application-list-query.dto'

@ApiTags('Карьера — отклики (студент)')
@ApiBearerAuth()
@Controller('career/applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiOperation({ summary: 'Свои отклики' })
  listMine(@CurrentUser() user: CurrentUserData, @Query() query: ApplicationListQueryDto) {
    return this.applications.listMine(user, query)
  }

  @Post()
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiOperation({ summary: 'Откликнуться на вакансию' })
  @ApiResponse({ status: 201, description: 'Отклик отправлен' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — вакансия недоступна вашему вузу' })
  @ApiResponse({ status: 409, description: 'CONFLICT — вы уже откликались' })
  apply(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateApplicationDto,
    @Req() req: FastifyRequest,
  ) {
    return this.applications.apply(user, dto, this.ctx(req))
  }

  @Get(':id/history')
  @Roles(Role.STUDENT, Role.STAROSTA, Role.EMPLOYER)
  @ApiOperation({ summary: 'История статусов отклика' })
  history(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.applications.history(user, id)
  }

  @Post(':id/withdraw')
  @Roles(Role.STUDENT, Role.STAROSTA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отозвать отклик' })
  withdraw(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.applications.withdraw(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}

@ApiTags('Карьера — кандидаты (компания)')
@ApiBearerAuth()
@Controller('career/employer/applications')
export class EmployerApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @Roles(Role.EMPLOYER)
  @ApiOperation({ summary: 'Воронка кандидатов компании' })
  pipeline(@CurrentUser() user: CurrentUserData, @Query() query: ApplicationListQueryDto) {
    return this.applications.pipeline(user, query)
  }

  @Patch(':id')
  @Roles(Role.EMPLOYER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Перевести отклик по воронке' })
  @ApiResponse({ status: 409, description: 'CONFLICT — недопустимый переход' })
  changeStatus(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChangeApplicationStatusDto,
    @Req() req: FastifyRequest,
  ) {
    return this.applications.changeStatus(user, id, dto, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
