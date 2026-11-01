import { createZodDto } from 'nestjs-zod'
import { UpdateStoryAudienceSchema } from '@studenthub/shared-schemas'

export class UpdateStoryAudienceDto extends createZodDto(UpdateStoryAudienceSchema) {}
