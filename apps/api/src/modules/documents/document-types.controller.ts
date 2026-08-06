import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { DocumentTypesService } from './document-types.service'
import { CreateCustomDocumentTypeDto, UpdateDocumentTypeDto } from './dto/document-type.dto'

// Управление типами документов вуза (Ф15D, 15.20). Только админ вуза (§15.2).
@ApiTags('Документы: типы')
@ApiBearerAuth()
@Roles(Role.UNIVERSITY_ADMIN)
@Controller('document-types')
export class DocumentTypesController {
  constructor(private readonly types: DocumentTypesService) {}

  @Get()
  @ApiOperation({ summary: 'Эффективный каталог типов вуза (статика + правки)' })
  list(@CurrentUser() user: CurrentUserData) {
    return this.types.list(user)
  }

  @Post()
  @ApiOperation({ summary: 'Добавить собственный тип документа' })
  addCustom(@CurrentUser() user: CurrentUserData, @Body() dto: CreateCustomDocumentTypeDto) {
    return this.types.addCustom(user, dto)
  }

  @Patch(':typeId')
  @ApiOperation({ summary: 'Включить/выключить тип и задать срок хранения' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('typeId') typeId: string,
    @Body() dto: UpdateDocumentTypeDto,
  ) {
    return this.types.updateType(user, typeId, dto)
  }

  @Delete(':typeId')
  @ApiOperation({
    summary: 'Сбросить настройку типа (удалить custom / вернуть статический к дефолту)',
  })
  remove(@CurrentUser() user: CurrentUserData, @Param('typeId') typeId: string) {
    return this.types.remove(user, typeId)
  }
}
