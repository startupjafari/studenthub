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
import { ApplicationsService } from './applications.service'
import { CreateApplicationDto } from './dto/create-application.dto'
import { TransitionApplicationDto } from './dto/transition-application.dto'
import { ApplicationListQueryDto } from './dto/application-list-query.dto'

@ApiTags('Заявки')
@ApiBearerAuth()
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post()
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Создать заявку в деканат (только STUDENT)' })
  @ApiResponse({ status: 201, description: 'Заявка создана (статус NEW)' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — студент без факультета' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateApplicationDto,
    @Req() req: FastifyRequest,
  ) {
    return this.applications.create(user, dto, this.ctx(req))
  }

  @Get()
  @ApiOperation({ summary: 'Список заявок по scope роли (студент — свои, декан — факультет…)' })
  @ApiResponse({ status: 200, description: 'Страница заявок' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: ApplicationListQueryDto) {
    return this.applications.list(user, query)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Заявка с историей статусов и вложениями (scope)' })
  @ApiResponse({ status: 200, description: 'Заявка' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.applications.getById(user, id)
  }

  @Patch(':id/status')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN)
  @ApiOperation({ summary: 'Сменить статус заявки (конечный автомат, только деканат/админ)' })
  @ApiResponse({ status: 200, description: 'Статус изменён' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — недопустимый переход' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  transition(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: TransitionApplicationDto,
    @Req() req: FastifyRequest,
  ) {
    return this.applications.transitionStatus(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отозвать заявку (владелец, только статус NEW)' })
  @ApiResponse({ status: 204, description: 'Заявка отозвана' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — не в статусе NEW' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.applications.withdraw(user, id, this.ctx(req))
  }

  @Post(':id/attachments')
  @Roles(Role.STUDENT)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Прикрепить файл к своей заявке (multipart, статусы NEW/CLARIFICATION)',
  })
  @ApiResponse({ status: 201, description: 'Файл прикреплён' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  @ApiResponse({ status: 415, description: 'FILE_TYPE_NOT_ALLOWED' })
  async addAttachment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    const buffer = await readSingleUpload(req)
    return this.applications.addAttachment(user, id, buffer, this.ctx(req))
  }

  @Get(':id/attachments/:fileId/presigned')
  @ApiOperation({
    summary: 'Presigned URL к вложению (владелец или деканат факультета, TTL 15 мин)',
  })
  @ApiResponse({ status: 200, description: '{ url }' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  attachmentUrl(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.applications.getAttachmentUrl(user, id, fileId)
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
