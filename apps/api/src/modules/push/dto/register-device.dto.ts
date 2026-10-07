import { createZodDto } from 'nestjs-zod'
import { RegisterDeviceSchema, UnregisterDeviceSchema } from '@studenthub/shared-schemas'

// Токен устройства для APNs (план iOS, Задача Б1).
export class RegisterDeviceDto extends createZodDto(RegisterDeviceSchema) {}
export class UnregisterDeviceDto extends createZodDto(UnregisterDeviceSchema) {}
