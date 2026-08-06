import { createZodDto } from 'nestjs-zod'
import { CreateAlbumSchema } from '@studenthub/shared-schemas'

export class CreateAlbumDto extends createZodDto(CreateAlbumSchema) {}
