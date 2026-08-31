import { createZodDto } from 'nestjs-zod'
import { CreateApplicationSchema } from '@studenthub/shared-schemas'

export class CreateApplicationDto extends createZodDto(CreateApplicationSchema) {}
