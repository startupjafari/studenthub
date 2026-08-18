import { createZodDto } from 'nestjs-zod'
import { PollVoteSchema } from '@studenthub/shared-schemas'

// Голос в опросе (§39): optionIds — выбранные варианты (пустой массив = снять голос).
export class PollVoteDto extends createZodDto(PollVoteSchema) {}
