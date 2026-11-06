import { createZodDto } from 'nestjs-zod'
import { ForgotPasswordSchema } from '@studenthub/shared-schemas'

// «Забыли пароль»: адрес, на который прислать ссылку.
export class ForgotPasswordDto extends createZodDto(ForgotPasswordSchema) {}
