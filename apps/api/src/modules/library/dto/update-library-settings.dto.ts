import { createZodDto } from 'nestjs-zod'
import { UpdateLibrarySettingsSchema } from '@studenthub/shared-schemas'

export class UpdateLibrarySettingsDto extends createZodDto(UpdateLibrarySettingsSchema) {}
