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
  Req,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { PortfolioService } from './portfolio.service'
import { CreatePortfolioItemDto } from './dto/create-portfolio-item.dto'
import { UpdatePortfolioItemDto } from './dto/update-portfolio-item.dto'

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
  @ApiOperation({ summary: 'Портфолио пользователя (с учётом приватности)' })
  ofUser(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.portfolio.listForUser(user, id)
  }

  @Post()
  @ApiOperation({ summary: 'Добавить запись портфолио' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreatePortfolioItemDto,
    @Req() req: FastifyRequest,
  ) {
    return this.portfolio.create(user, dto, this.ctx(req))
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
