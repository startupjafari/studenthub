import { createZodDto } from 'nestjs-zod'
import { MessageIdsSchema } from '@studenthub/shared-schemas'

/** Пачка id сообщений: «удалить у себя» и «удалить у всех». */
export class MessageIdsDto extends createZodDto(MessageIdsSchema) {}
