import { createZodDto } from 'nestjs-zod'
import { CampusPresenceSchema } from '@studenthub/shared-schemas'

export class CampusPresenceDto extends createZodDto(CampusPresenceSchema) {}
