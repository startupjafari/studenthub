import { createZodDto } from 'nestjs-zod'
import { SaveGradesSchema } from '@studenthub/shared-schemas'

export class SaveGradesDto extends createZodDto(SaveGradesSchema) {}
