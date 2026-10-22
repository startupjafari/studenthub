import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RestrictedAllowed } from '../../common/decorators/restricted-allowed.decorator'
import { AppException } from '../../common/exceptions/app.exception'
import { readSingleUpload } from '../../common/http/read-upload'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { LibraryCatalogService } from './library-catalog.service'
import { LibraryImportService, parseLibraryImportFile } from './library-import.service'
import { AddBookCopiesDto } from './dto/add-book-copies.dto'
import { BookCopyLabelsDto } from './dto/book-copy-labels.dto'
import { BookListQueryDto } from './dto/book-list-query.dto'
import { CreateBookDto } from './dto/create-book.dto'
import { LibraryImportCommitDto } from './dto/library-import-commit.dto'
import { UpdateBookCopyDto } from './dto/update-book-copy.dto'
import { UpdateBookDto } from './dto/update-book.dto'

const MEMBERS = [Role.STUDENT, Role.STAROSTA, Role.LIBRARIAN, Role.UNIVERSITY_ADMIN] as const
const STAFF = [Role.LIBRARIAN, Role.UNIVERSITY_ADMIN] as const
const FILE_BODY = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
}

// Каталог и экземпляры библиотеки (docs/PROJECT.md §3.11). Каталог видят читатели
// включённой библиотеки и те, кто ведёт фонд; фонд ведут библиотекарь и админ вуза.
//
// ВНИМАНИЕ: статические пути (`books/sections`, `copies/labels`, `copies/by-code/:code`)
// объявлены раньше параметрических `:id`.
@ApiTags('Библиотека')
@ApiBearerAuth()
@RestrictedAllowed(Role.LIBRARIAN)
@Controller('library')
export class LibraryCatalogController {
  constructor(
    private readonly catalog: LibraryCatalogService,
    private readonly importer: LibraryImportService,
  ) {}

  // ── Каталог ──────────────────────────────────────────────────────────────────────

  @Get('books')
  @Roles(...MEMBERS)
  @ApiOperation({ summary: 'Каталог: поиск по названию, авторам и ISBN, наличие экземпляров' })
  @ApiResponse({ status: 409, description: 'Библиотека вуза выключена (для читателей)' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: BookListQueryDto) {
    return this.catalog.list(user, query)
  }

  @Get('books/sections')
  @Roles(...MEMBERS)
  @ApiOperation({ summary: 'Разделы каталога вуза — для фильтра' })
  sections(@CurrentUser() user: CurrentUserData) {
    return this.catalog.sections(user)
  }

  @Post('books')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Завести книгу в каталог' })
  @ApiResponse({ status: 422, description: 'Неверные поля карточки' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateBookDto,
    @Req() req: FastifyRequest,
  ) {
    return this.catalog.create(user, dto, this.ctx(req))
  }

  @Get('books/:id')
  @Roles(...MEMBERS)
  @ApiOperation({ summary: 'Книга: фонду — с экземплярами и выдачами, читателю — наличие' })
  @ApiResponse({ status: 404, description: 'Книги нет или она чужого вуза' })
  detail(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.catalog.detail(user, id)
  }

  @Patch('books/:id')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Правка карточки, архив и возврат из архива' })
  @ApiResponse({ status: 409, description: 'В архив нельзя: экземпляры выданы или под бронью' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateBookDto,
    @Req() req: FastifyRequest,
  ) {
    return this.catalog.update(user, id, dto, this.ctx(req))
  }

  @Post('books/:id/cover')
  @Roles(...STAFF)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @ApiOperation({ summary: 'Загрузить обложку книги (картинка до 10 МБ)' })
  async cover(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    const buffer = await readSingleUpload(req)
    return this.catalog.uploadCover(user, id, buffer, this.ctx(req))
  }

  @Post('books/:id/copies')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Завести экземпляры: номерами списком или количеством по порядку' })
  @ApiResponse({ status: 409, description: 'Инвентарный номер уже есть в фонде' })
  addCopies(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AddBookCopiesDto,
    @Req() req: FastifyRequest,
  ) {
    return this.catalog.addCopies(user, id, dto, this.ctx(req))
  }

  // ── Экземпляры ───────────────────────────────────────────────────────────────────

  @Post('copies/labels')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'QR-наклейки экземпляров для печати' })
  labels(@CurrentUser() user: CurrentUserData, @Body() dto: BookCopyLabelsDto) {
    return this.catalog.labels(user, dto.copyIds)
  }

  @Get('copies/by-code/:code')
  @Roles(...MEMBERS)
  @ApiOperation({ summary: 'Экземпляр по коду с наклейки' })
  @ApiResponse({ status: 404, description: 'Код неизвестен, устарел или чужого вуза' })
  byCode(@CurrentUser() user: CurrentUserData, @Param('code') code: string) {
    return this.catalog.byCode(user, code)
  }

  @Patch('copies/:id')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Правка экземпляра: номер, состояние, заметка, вывод из оборота' })
  @ApiResponse({ status: 409, description: 'Экземпляр выдан или под бронью; номер занят' })
  updateCopy(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateBookCopyDto,
    @Req() req: FastifyRequest,
  ) {
    return this.catalog.updateCopy(user, id, dto, this.ctx(req))
  }

  @Post('copies/:id/code/rotate')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Перевыпустить код наклейки: старая распечатка перестаёт работать' })
  rotateCode(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.catalog.rotateCopyCode(user, id, this.ctx(req))
  }

  // ── Импорт фонда ─────────────────────────────────────────────────────────────────

  @Post('import/preview')
  @Roles(...STAFF)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @ApiOperation({ summary: 'Импорт фонда: проверить CSV/XLSX без записи' })
  @ApiResponse({ status: 400, description: 'Формат файла или нет колонки «Название»' })
  async importPreview(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    const { buffer, filename } = await this.readFile(req)
    return this.importer.preview(user, parseLibraryImportFile(buffer, filename))
  }

  @Post('import')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Импорт фонда: записать проверенные строки' })
  @ApiResponse({ status: 409, description: 'Инвентарный номер успели занять' })
  importCommit(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: LibraryImportCommitDto,
    @Req() req: FastifyRequest,
  ) {
    return this.importer.commit(user, dto, this.ctx(req))
  }

  private async readFile(req: FastifyRequest): Promise<{ buffer: Buffer; filename: string }> {
    const part = await req.file()
    if (!part) {
      throw new AppException('BAD_REQUEST', 'Файл не передан (ожидается multipart-поле "file")')
    }
    try {
      return { buffer: await part.toBuffer(), filename: part.filename }
    } catch {
      throw new AppException('BAD_REQUEST', 'Файл слишком большой для импорта')
    }
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
