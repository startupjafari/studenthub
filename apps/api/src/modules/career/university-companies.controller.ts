import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { Paginated } from '../../common/http/paginated'
import type { RequestContext } from '../auth/auth.service'
import { CompaniesService } from './companies.service'
import { CompanyListQueryDto } from './dto/company-list-query.dto'
import { DecideCompanyAccessDto } from './dto/decide-company-access.dto'

/**
 * Карьерный центр вуза: очередь заявок компаний и решения по ним.
 *
 * Скоуп берётся из токена сотрудника, а не из пути — вуз в URL не передаётся вовсе,
 * поэтому админ одного вуза физически не может запросить очередь другого.
 */
@ApiTags('Карьера — допуск компаний (вуз)')
@ApiBearerAuth()
@Controller('career/university/companies')
export class UniversityCompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR, Role.DEAN)
  @ApiOperation({ summary: 'Заявки и допуски компаний своего университета' })
  @ApiResponse({ status: 200, description: 'Страница заявок' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  async list(@CurrentUser() user: CurrentUserData, @Query() query: CompanyListQueryDto) {
    const { items, total } = await this.companies.universityAccessList(user, query)
    return new Paginated(items, { total })
  }

  @Patch(':id')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Решение по заявке: одобрить, отклонить или отозвать допуск' })
  @ApiResponse({ status: 204, description: 'Решение принято' })
  @ApiResponse({ status: 409, description: 'CONFLICT — недопустимый переход статуса' })
  decide(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: DecideCompanyAccessDto,
    @Req() req: FastifyRequest,
  ) {
    return this.companies.decideAccess(user, id, dto, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
