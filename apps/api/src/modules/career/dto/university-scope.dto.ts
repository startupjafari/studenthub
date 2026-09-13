import { createZodDto } from 'nestjs-zod'
import { UniversityScopeSchema } from '@studenthub/shared-schemas'

/** ?universityId — вуз, в чьём scope смотрит платформенная роль (см. career-scope.ts). */
export class UniversityScopeDto extends createZodDto(UniversityScopeSchema) {}
