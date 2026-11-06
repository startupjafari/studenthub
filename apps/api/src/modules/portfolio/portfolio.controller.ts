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
  Req,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { PortfolioService } from './portfolio.service'
import { CreatePortfolioItemDto } from './dto/create-portfolio-item.dto'
import { UpdatePortfolioItemDto } from './dto/update-portfolio-item.dto'
import { ReorderPortfolioDto } from './dto/reorder-portfolio.dto'

@ApiTags('Портфолио')
@ApiBearerAuth()
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get('mine')
  @ApiOperation({ summary: 'Моё портфолио (все записи, включая приватные)' })
  mine(@CurrentUser() user: CurrentUserData) {
    return this.portfolio.listMine(user)
  }

  @Get('user/:id')
  @ApiOperation({
    summary: 'Портфолио пользователя (с учётом приватности)',
    description: 'Закрытый для смотрящего профиль — пустой список, как у фото и статей.',
  })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — нет пользователя или аккаунт удалён' })
  ofUser(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.portfolio.listForUser(user, id)
  }

  @Post()
  @ApiOperation({ summary: 'Добавить запись портфолио' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — достигнут потолок PORTFOLIO_MAX_ITEMS' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreatePortfolioItemDto,
    @Req() req: FastifyRequest,
  ) {
    return this.portfolio.create(user, dto, this.ctx(req))
  }

  @Put('order')
  @ApiOperation({
    summary: 'Порядок записей портфолио',
    description:
      'ids — свои записи в нужном порядке; не перечисленные встают следом в прежнем порядке. ' +
      'Ответ — портфолио целиком, как GET /portfolio/mine.',
  })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — среди ids есть чужая запись' })
  reorder(@CurrentUser() user: CurrentUserData, @Body() dto: ReorderPortfolioDto) {
    return this.portfolio.reorder(user, dto)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить запись портфолио' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdatePortfolioItemDto,
    @Req() req: FastifyRequest,
  ) {
    return this.portfolio.update(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить запись портфолио' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.portfolio.remove(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
