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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { readSingleUpload } from '../../common/http/read-upload'
import type { RequestContext } from '../auth/auth.service'
import { UniversityPageService, type UniversityImageKind } from './university-page.service'
import { UpdateUniversityPageDto } from './dto/update-university-page.dto'

const IMAGE_BODY = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
}

// Страница университета (витрина в стиле профиля). Читают свои, платформа и компании с
// допуском; правит админ своего вуза — вуз из токена (`my`), а не из адреса.
@ApiTags('Университеты — страница')
@ApiBearerAuth()
@Controller('universities')
export class UniversityPageController {
  constructor(private readonly pages: UniversityPageService) {}

  @Patch('my/page')
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Изменить страницу своего университета (описание, контакты, соцсети)' })
  @ApiResponse({ status: 200, description: 'Страница университета' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не админ вуза' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateUniversityPageDto,
    @Req() req: FastifyRequest,
  ) {
    return this.pages.update(user, dto, this.ctx(req))
  }

  @Post('my/page/logo')
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  @ApiOperation({ summary: 'Загрузить логотип своего университета (изображение ≤ 10 МБ)' })
  @ApiResponse({ status: 201, description: '{ url } — публичная ссылка на логотип' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE' })
  setLogo(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    return this.setImage(user, 'logo', req)
  }

  @Delete('my/page/logo')
  @Roles(Role.UNIVERSITY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить логотип своего университета' })
  @ApiResponse({ status: 204, description: 'Удалён' })
  async removeLogo(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    await this.pages.removeImage(user, 'logo', this.ctx(req))
  }

  @Post('my/page/cover')
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  @ApiOperation({ summary: 'Загрузить обложку страницы своего университета (≤ 10 МБ)' })
  @ApiResponse({ status: 201, description: '{ url } — публичная ссылка на обложку' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE' })
  setCover(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    return this.setImage(user, 'cover', req)
  }

  @Delete('my/page/cover')
  @Roles(Role.UNIVERSITY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить обложку страницы своего университета' })
  @ApiResponse({ status: 204, description: 'Удалена' })
  async removeCover(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    await this.pages.removeImage(user, 'cover', this.ctx(req))
  }

  @Get(':id/page')
  @ApiOperation({
    summary: 'Страница университета (витрина) — свои, платформа, компании с допуском',
  })
  @ApiResponse({ status: 200, description: 'Страница; canPublish/canEdit — права смотрящего' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — нет вуза или нет доступа' })
  page(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.pages.page(user, id)
  }

  private async setImage(user: CurrentUserData, kind: UniversityImageKind, req: FastifyRequest) {
    const buffer = await readSingleUpload(req)
    return this.pages.setImage(user, kind, buffer, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
