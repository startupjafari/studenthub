import { createZodDto } from 'nestjs-zod'
import { MergeSupportSchema } from '@studenthub/shared-schemas'

export class MergeSupportDto extends createZodDto(MergeSupportSchema) {}
