import { createZodDto } from 'nestjs-zod'
import { LibraryImportCommitSchema } from '@studenthub/shared-schemas'

export class LibraryImportCommitDto extends createZodDto(LibraryImportCommitSchema) {}
