import { createZodDto } from 'nestjs-zod'
import {
  MultipartAbortSchema,
  MultipartCompleteSchema,
  MultipartStartSchema,
  MultipartUrlsSchema,
} from '@studenthub/shared-schemas'

export class MultipartStartDto extends createZodDto(MultipartStartSchema) {}
export class MultipartUrlsDto extends createZodDto(MultipartUrlsSchema) {}
export class MultipartCompleteDto extends createZodDto(MultipartCompleteSchema) {}
export class MultipartAbortDto extends createZodDto(MultipartAbortSchema) {}
