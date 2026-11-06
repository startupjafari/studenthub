import { createZodDto } from 'nestjs-zod'
import { UpdateCameraSettingsSchema } from '@studenthub/shared-schemas'

export class UpdateCameraSettingsDto extends createZodDto(UpdateCameraSettingsSchema) {}
