import { createZodDto } from 'nestjs-zod'
import { MuteSchema } from '@studenthub/shared-schemas'

// Заглушить чат (§17): { minutes? } — на сколько (нет/0 → «навсегда»);
// { importantOnly? } — режим «только важные»: ответы мне и упоминания всё равно уведомляют.
export class MuteDto extends createZodDto(MuteSchema) {}
