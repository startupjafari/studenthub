import { createZodDto } from 'nestjs-zod'
import { PinPostSchema } from '@studenthub/shared-schemas'

export class PinPostDto extends createZodDto(PinPostSchema) {}
