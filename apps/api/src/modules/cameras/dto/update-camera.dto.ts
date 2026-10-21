import { createZodDto } from 'nestjs-zod'
import { UpdateCameraSchema } from '@studenthub/shared-schemas'

export class UpdateCameraDto extends createZodDto(UpdateCameraSchema) {}
