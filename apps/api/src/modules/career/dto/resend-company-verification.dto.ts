import { createZodDto } from 'nestjs-zod'
import { ResendCompanyVerificationSchema } from '@studenthub/shared-schemas'

export class ResendCompanyVerificationDto extends createZodDto(ResendCompanyVerificationSchema) {}
