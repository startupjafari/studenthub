import { createZodDto } from 'nestjs-zod'
import { CampusSearchSchema } from '@studenthub/shared-schemas'

export class CampusSearchDto extends createZodDto(CampusSearchSchema) {}
