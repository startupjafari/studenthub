import { createZodDto } from 'nestjs-zod'
import { MarkChatsReadSchema } from '@studenthub/shared-schemas'

export class MarkChatsReadDto extends createZodDto(MarkChatsReadSchema) {}
