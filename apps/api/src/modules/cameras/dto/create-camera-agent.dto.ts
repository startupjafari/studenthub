import { createZodDto } from 'nestjs-zod'
import { CreateCameraAgentSchema } from '@studenthub/shared-schemas'

export class CreateCameraAgentDto extends createZodDto(CreateCameraAgentSchema) {}
