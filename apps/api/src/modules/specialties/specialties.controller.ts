import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { SpecialtiesService } from './specialties.service'
import { CreateSpecialtyDto } from './dto/create-specialty.dto'

@ApiTags('Специальности')
@Controller('specialties')
export class SpecialtiesController {
  constructor(private readonly specialties: SpecialtiesService) {}

  @Get()
  @ApiOperation({ summary: 'Специальности своего вуза (для профиля и админа)' })
  list(@CurrentUser() user: CurrentUserData) {
    return this.specialties.list(user)
  }

  @Post()
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Добавить специальность (админ вуза, в свой вуз)' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateSpecialtyDto,
    @Req() req: FastifyRequest,
  ) {
    return this.specialties.create(user, dto, this.ctx(req))
  }

  @Delete(':id')
  @Roles(Role.UNIVERSITY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить специальность (админ вуза)' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.specialties.remove(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
