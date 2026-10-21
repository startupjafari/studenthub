import { createZodDto } from 'nestjs-zod'
import { CameraListQuerySchema } from '@studenthub/shared-schemas'

export class CameraListQueryDto extends createZodDto(CameraListQuerySchema) {}
