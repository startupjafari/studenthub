import { createZodDto } from 'nestjs-zod'
import { MuteSchema } from '@studenthub/shared-schemas'

// Заглушить чат (§17): { minutes? } — на сколько (нет/0 → «навсегда»).
export class MuteDto extends createZodDto(MuteSchema) {}
