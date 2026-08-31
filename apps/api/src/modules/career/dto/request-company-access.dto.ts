import { createZodDto } from 'nestjs-zod'
import { RequestCompanyAccessSchema } from '@studenthub/shared-schemas'

export class RequestCompanyAccessDto extends createZodDto(RequestCompanyAccessSchema) {}
