import { createZodDto } from 'nestjs-zod'
import { CameraAgentSyncSchema } from '@studenthub/shared-schemas'

export class CameraAgentSyncDto extends createZodDto(CameraAgentSyncSchema) {}
