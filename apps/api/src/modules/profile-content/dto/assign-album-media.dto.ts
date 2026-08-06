import { createZodDto } from 'nestjs-zod'
import { AssignAlbumMediaSchema } from '@studenthub/shared-schemas'

export class AssignAlbumMediaDto extends createZodDto(AssignAlbumMediaSchema) {}
