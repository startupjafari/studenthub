import { createZodDto } from 'nestjs-zod'
import { UpdatePostSchema } from '@studenthub/shared-schemas'

export class UpdatePostDto extends createZodDto(UpdatePostSchema) {}
