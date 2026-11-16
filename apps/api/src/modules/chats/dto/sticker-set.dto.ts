import { createZodDto } from 'nestjs-zod'
import { StickerSetCreateSchema, StickerSetUpdateSchema } from '@studenthub/shared-schemas'

export class StickerSetCreateDto extends createZodDto(StickerSetCreateSchema) {}
export class StickerSetUpdateDto extends createZodDto(StickerSetUpdateSchema) {}
