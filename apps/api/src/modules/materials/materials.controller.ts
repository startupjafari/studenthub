import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
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
import { MaterialsService } from './materials.service'
import { CreateMaterialDto } from './dto/create-material.dto'
import { MaterialListQueryDto } from './dto/material-list-query.dto'

const AUTHOR_ROLES = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER] as const

@ApiTags('Материалы')
@ApiBearerAuth()
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get()
  @ApiOperation({ summary: 'Учебные материалы по scope (студент — своя группа)' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: MaterialListQueryDto) {
    return this.materials.list(user, query)
  }

  @Post()
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Создать материал для группы' })
  @ApiResponse({ status: 201, description: 'Материал создан' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateMaterialDto,
    @Req() req: FastifyRequest,
  ) {
    return this.materials.create(user, dto, this.ctx(req))
  }

  @Post(':id/files')
  @Roles(...AUTHOR_ROLES)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Прикрепить файл к материалу (автор/админ)' })
  async addFile(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    const buffer = await readSingleUpload(req)
    return this.materials.addFile(user, id, buffer, this.ctx(req))
  }

  @Get(':id/files/:fileId/presigned')
  @ApiOperation({ summary: 'Presigned URL к файлу материала (по scope)' })
  fileUrl(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.materials.getFileUrl(user, id, fileId)
  }

  @Delete(':id')
  @Roles(...AUTHOR_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить материал (автор/админ)' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.materials.remove(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
