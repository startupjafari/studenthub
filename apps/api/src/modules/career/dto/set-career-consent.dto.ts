import { createZodDto } from 'nestjs-zod'
import { SetCareerConsentSchema } from '@studenthub/shared-schemas'

export class SetCareerConsentDto extends createZodDto(SetCareerConsentSchema) {}
