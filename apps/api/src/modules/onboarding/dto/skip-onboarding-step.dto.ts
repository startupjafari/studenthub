import { createZodDto } from 'nestjs-zod'
import { SkipOnboardingStepSchema } from '@studenthub/shared-schemas'

export class SkipOnboardingStepDto extends createZodDto(SkipOnboardingStepSchema) {}
