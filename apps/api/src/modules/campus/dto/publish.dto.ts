import { createZodDto } from 'nestjs-zod'
import { PublishCampusSchema } from '@studenthub/shared-schemas'

export class CampusPublishDto extends createZodDto(PublishCampusSchema) {}
