import { createZodDto } from 'nestjs-zod'
import { RoomQrBatchSchema } from '@studenthub/shared-schemas'

export class RoomQrBatchDto extends createZodDto(RoomQrBatchSchema) {}
