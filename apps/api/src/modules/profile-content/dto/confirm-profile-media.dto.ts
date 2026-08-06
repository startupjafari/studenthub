import { createZodDto } from 'nestjs-zod'
import { ConfirmProfileMediaSchema } from '@studenthub/shared-schemas'

export class ConfirmProfileMediaDto extends createZodDto(ConfirmProfileMediaSchema) {}
