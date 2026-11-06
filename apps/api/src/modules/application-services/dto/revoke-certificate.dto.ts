import { createZodDto } from 'nestjs-zod'
import { RevokeCertificateSchema } from '@studenthub/shared-schemas'

export class RevokeCertificateDto extends createZodDto(RevokeCertificateSchema) {}
