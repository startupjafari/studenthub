import { createZodDto } from 'nestjs-zod'
import {
  StickerSetPreviewQuerySchema,
  UserStickerReorderSchema,
  UserStickerSetCreateSchema,
  UserStickerSetUpdateSchema,
} from '@studenthub/shared-schemas'

export class UserStickerSetCreateDto extends createZodDto(UserStickerSetCreateSchema) {}
export class UserStickerSetUpdateDto extends createZodDto(UserStickerSetUpdateSchema) {}
export class UserStickerReorderDto extends createZodDto(UserStickerReorderSchema) {}
export class StickerSetPreviewQueryDto extends createZodDto(StickerSetPreviewQuerySchema) {}
