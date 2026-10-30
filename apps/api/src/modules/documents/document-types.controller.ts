import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { DocumentTypesService } from './document-types.service'
import { CreateCustomDocumentTypeDto, UpdateDocumentTypeDto } from './dto/document-type.dto'

// Типы документов вуза (Ф15D, 15.20). Управление — только админ вуза (§15.2), поэтому
// @Roles стоит на каждом изменяющем маршруте, а не на классе: каталог для выбора типа
// (`GET /document-types/effective`) нужен всем, кто загружает или запрашивает документы.
@ApiTags('Документы: типы')
@ApiBearerAuth()
@Controller('document-types')
export class DocumentTypesController {
  constructor(private readonly types: DocumentTypesService) {}

  // Без @Roles: та же видимость, что у самих документов. Вуз — только из токена; у ролей
  // без вуза (платформа, работодатель) — статический каталог, ровно как проверяет сервер.
  @Get('effective')
  @ApiOperation({
    summary: 'Каталог типов своего вуза для выбора (все роли; выключенные — с enabled=false)',
  })
  effective(@CurrentUser() user: CurrentUserData) {
    return this.types.effective(user.universityId)
  }

  @Get()
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Эффективный каталог типов вуза (статика + правки)' })
  list(@CurrentUser() user: CurrentUserData) {
    return this.types.list(user)
  }

  @Post()
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Добавить собственный тип документа' })
  addCustom(@CurrentUser() user: CurrentUserData, @Body() dto: CreateCustomDocumentTypeDto) {
    return this.types.addCustom(user, dto)
  }

  @Patch(':typeId')
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Включить/выключить тип и задать срок хранения' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('typeId') typeId: string,
    @Body() dto: UpdateDocumentTypeDto,
  ) {
    return this.types.updateType(user, typeId, dto)
  }

  @Delete(':typeId')
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({
    summary: 'Сбросить настройку типа (удалить custom / вернуть статический к дефолту)',
  })
  remove(@CurrentUser() user: CurrentUserData, @Param('typeId') typeId: string) {
    return this.types.remove(user, typeId)
  }
}
