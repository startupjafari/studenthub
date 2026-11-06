import { createZodDto } from 'nestjs-zod'
import { CreateCameraSchema } from '@studenthub/shared-schemas'

export class CreateCameraDto extends createZodDto(CreateCameraSchema) {}
