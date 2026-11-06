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
  Res,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'
import { attachmentHeader } from '../../common/http/content-disposition'
import { readNamedUpload } from '../../common/http/read-upload'
import {
  DOCX_MIME,
  DocumentTemplatesService,
  type GeneratedDocx,
  type RequestMeta,
} from './document-templates.service'
import {
  CreateDocumentTemplateDto,
  DocumentTemplateListQueryDto,
  DocumentTemplateTestQueryDto,
  GenerateDocumentFromTemplateDto,
  UpdateDocumentTemplateDto,
} from './dto/document-template.dto'

function meta(req: FastifyRequest): RequestMeta {
  return { ip: req.ip, userAgent: req.headers['user-agent'] }
}

async function sendDocx(reply: FastifyReply, file: GeneratedDocx): Promise<void> {
  await reply
    .header('content-type', DOCX_MIME)
    .header('content-disposition', attachmentHeader(file.filename))
    // Документ с персональными данными не должен оседать ни в одном промежуточном кэше.
    .header('cache-control', 'no-store')
    .send(file.buffer)
}

// DOCX-шаблоны документов вуза (docs/PROJECT.md §3.8 «Шаблоны документов»).
// Управление — только админ вуза; сформировать документ для студента и увидеть
// опубликованные шаблоны могут ещё модератор вуза и декан (те, кто обрабатывает заявки).
@ApiTags('Документы: шаблоны DOCX')
@ApiBearerAuth()
@Controller('document-templates')
export class DocumentTemplatesController {
  constructor(private readonly templates: DocumentTemplatesService) {}

  @Get()
  @Roles(Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR, Role.DEAN)
  @ApiOperation({
    summary: 'Шаблоны своего вуза (админ — все, модератор и декан — опубликованные)',
  })
  @ApiResponse({ status: 200, description: 'Страница шаблонов, meta.total' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — роль не подходит' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — параметры списка' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: DocumentTemplateListQueryDto) {
    return this.templates.list(user, query)
  }

  @Get(':id')
  @Roles(Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR, Role.DEAN)
  @ApiOperation({ summary: 'Шаблон: метаданные, версии и результаты их проверки' })
  @ApiResponse({ status: 200, description: 'Карточка шаблона' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — шаблон другого вуза' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  get(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.templates.get(user, id)
  }

  @Post()
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Создать шаблон (черновик без файла)' })
  @ApiResponse({ status: 201, description: 'Карточка шаблона' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateDocumentTemplateDto,
    @Req() req: FastifyRequest,
  ) {
    return this.templates.create(user, dto, meta(req))
  }

  @Patch(':id')
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Изменить название, вид, описание или язык шаблона' })
  @ApiResponse({ status: 200, description: 'Карточка шаблона' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  @ApiResponse({ status: 409, description: 'CONFLICT — шаблон в архиве' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentTemplateDto,
    @Req() req: FastifyRequest,
  ) {
    return this.templates.update(user, id, dto, meta(req))
  }

  @Delete(':id')
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({
    summary: 'Удалить шаблон; если по нему уже выдавали документы — отправить в архив',
  })
  @ApiResponse({ status: 200, description: '{ archived } — true, если шаблон архивирован' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.templates.remove(user, id, meta(req))
  }

  @Post(':id/versions')
  @Roles(Role.UNIVERSITY_ADMIN)
  // Каждая загрузка — разбор архива и шаблона в процессе API: частота ограничена.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Загрузить DOCX новой версией: проверка файла и переменных',
  })
  @ApiResponse({ status: 201, description: 'Карточка шаблона с отчётом проверки версии' })
  @ApiResponse({ status: 409, description: 'CONFLICT — шаблон в архиве' })
  @ApiResponse({ status: 413, description: 'FILE_TOO_LARGE — больше предела шаблона' })
  @ApiResponse({ status: 415, description: 'FILE_TYPE_NOT_ALLOWED — не .docx' })
  @ApiResponse({
    status: 422,
    description: 'TEMPLATE_FILE_INVALID — повреждён, макросы, внешние ссылки, zip-бомба',
  })
  async upload(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    let upload: { buffer: Buffer; filename: string }
    try {
      upload = await readNamedUpload(req)
    } catch (error) {
      // Буферная загрузка обрывается на 10 МБ; для шаблона это просто «слишком большой».
      if (error instanceof AppException && error.code === 'FILE_DIRECT_UPLOAD_REQUIRED') {
        throw new AppException('FILE_TOO_LARGE', 'Файл шаблона слишком большой')
      }
      throw error
    }
    return this.templates.uploadVersion(user, id, upload, meta(req))
  }

  @Get(':id/versions/:versionId/source')
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Ссылка на исходный DOCX версии (presigned, 15 минут)' })
  @ApiResponse({ status: 200, description: '{ url, fileName }' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — версии нет у этого шаблона' })
  source(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.templates.sourceUrl(user, id, versionId)
  }

  @Post(':id/publish')
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Опубликовать рабочую версию (только прошедшую проверку)' })
  @ApiResponse({ status: 201, description: 'Карточка шаблона' })
  @ApiResponse({ status: 409, description: 'CONFLICT — архив или файл только что заменили' })
  @ApiResponse({ status: 422, description: 'TEMPLATE_INVALID — нет файла или есть ошибки' })
  publish(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.templates.publish(user, id, meta(req))
  }

  @Post(':id/unpublish')
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Снять с публикации (вернуть в черновик)' })
  @ApiResponse({ status: 201, description: 'Карточка шаблона' })
  unpublish(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.templates.unpublish(user, id, meta(req))
  }

  @Post(':id/test')
  // Ответ — файл, а не созданный ресурс: 200, как у обычного скачивания.
  @HttpCode(HttpStatus.OK)
  @Roles(Role.UNIVERSITY_ADMIN)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiProduces(DOCX_MIME)
  @ApiOperation({ summary: 'Проверочный DOCX на демонстрационных данных' })
  @ApiResponse({ status: 200, description: 'Файл DOCX' })
  @ApiResponse({ status: 422, description: 'TEMPLATE_INVALID — версия не прошла проверку' })
  async test(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: DocumentTemplateTestQueryDto,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await sendDocx(reply, await this.templates.testGenerate(user, id, query.versionId, meta(req)))
  }

  @Post(':id/generate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR, Role.DEAN)
  // Документ несёт персональные данные: ручку нельзя превращать в выгрузку всего вуза.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiProduces(DOCX_MIME)
  @ApiOperation({ summary: 'Сформировать документ для студента по опубликованной версии' })
  @ApiResponse({ status: 200, description: 'Файл DOCX' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — шаблон не опубликован' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — шаблон или студент вне вашей области' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — нет шаблона или студента' })
  @ApiResponse({
    status: 422,
    description: 'TEMPLATE_DATA_MISSING — в профиле не заполнены поля (details[].field)',
  })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT — больше 30 документов в минуту' })
  async generate(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: GenerateDocumentFromTemplateDto,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await sendDocx(
      reply,
      await this.templates.generateForStudent(user, id, dto.studentId, meta(req)),
    )
  }
}
