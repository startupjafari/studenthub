import { createZodDto } from 'nestjs-zod'
import { UpdateCameraAgentSchema } from '@studenthub/shared-schemas'

export class UpdateCameraAgentDto extends createZodDto(UpdateCameraAgentSchema) {}
