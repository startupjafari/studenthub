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
import type { FastifyRequest } from 'fastify'
import { StickerUploadFieldsSchema } from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'
import { readUploadWithFields } from '../../common/http/read-upload'
import { ChatStickersService } from './chat-stickers.service'
import { StickerSetCreateDto, StickerSetUpdateDto } from './dto/sticker-set.dto'

// Каталог стикеров чатов: заводит, наполняет и публикует только платформенный администратор.
// Модератора среди пишущих нет: каталог видят все пользователи всех вузов, и его состав —
// решение платформы, а не разбор жалоб. Каждая запись пишется в AuditLog.
@ApiTags('Стикеры (админ)')
@ApiBearerAuth()
@Roles(Role.PLATFORM_ADMIN)
@Controller('admin/sticker-sets')
export class StickerSetsAdminController {
  constructor(private readonly stickers: ChatStickersService) {}

  @Get()
  @ApiOperation({ summary: 'Все наборы стикеров, включая неопубликованные' })
  @ApiResponse({ status: 200, description: 'Наборы со стикерами' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не PLATFORM_ADMIN' })
  list() {
    return this.stickers.listAll()
  }

  @Post()
  @ApiOperation({ summary: 'Создать набор (не опубликован)' })
  @ApiResponse({ status: 201, description: 'Набор создан' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не PLATFORM_ADMIN' })
  @ApiResponse({ status: 409, description: 'CONFLICT — короткое имя занято' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: StickerSetCreateDto) {
    return this.stickers.createSet(user.sub, dto)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить название, порядок или публикацию набора' })
  @ApiResponse({ status: 200, description: 'Набор после изменения' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — набора нет' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: StickerSetUpdateDto,
  ) {
    return this.stickers.updateSet(user.sub, id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить набор со всеми стикерами' })
  @ApiResponse({ status: 204, description: 'Набор удалён' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — набора нет' })
  async remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string): Promise<void> {
    await this.stickers.deleteSet(user.sub, id)
  }

  @Post(':id/stickers')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'PNG, WebP или GIF, ≤ 512 КБ' },
        emoji: { type: 'string', description: 'Один эмодзи — подсказка к стикеру' },
      },
    },
  })
  @ApiOperation({ summary: 'Добавить стикер в набор' })
  @ApiResponse({ status: 201, description: 'Набор после изменения' })
  @ApiResponse({ status: 413, description: 'FILE_TOO_LARGE — больше 512 КБ' })
  @ApiResponse({ status: 415, description: 'FILE_TYPE_NOT_ALLOWED — не PNG/WebP/GIF' })
  async addSticker(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    const { fields, files } = await readUploadWithFields(req)
    const file = files[0]
    if (!file || files.length !== 1) {
      throw new AppException('BAD_REQUEST', 'Ожидается ровно один файл в поле "file"')
    }
    const parsed = StickerUploadFieldsSchema.safeParse({ emoji: fields.emoji || undefined })
    if (!parsed.success) throw new AppException('BAD_REQUEST', 'Эмодзи стикера — один эмодзи')
    return this.stickers.addSticker(
      user.sub,
      id,
      { buffer: file.buffer, name: file.filename },
      parsed.data.emoji,
    )
  }

  @Delete(':id/stickers/:stickerId')
  @ApiOperation({ summary: 'Удалить стикер из набора' })
  @ApiResponse({ status: 200, description: 'Набор после изменения' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — стикера нет в наборе' })
  removeSticker(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('stickerId') stickerId: string,
  ) {
    return this.stickers.deleteSticker(user.sub, id, stickerId)
  }
}
