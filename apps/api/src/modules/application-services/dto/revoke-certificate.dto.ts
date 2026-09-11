import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// Причина отзыва необязательна, но если её указали — она попадает в событие заявки и
// остаётся в истории: «почему отозвали» спрашивают чаще, чем «когда».
const RevokeCertificateSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
})

export class RevokeCertificateDto extends createZodDto(RevokeCertificateSchema) {}
