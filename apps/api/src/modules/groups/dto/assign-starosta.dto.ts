import { createZodDto } from 'nestjs-zod'
import { AssignStarostaSchema } from '@studenthub/shared-schemas'

export class AssignStarostaDto extends createZodDto(AssignStarostaSchema) {}
