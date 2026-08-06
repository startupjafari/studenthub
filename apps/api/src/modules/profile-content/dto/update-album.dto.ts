import { createZodDto } from 'nestjs-zod'
import { UpdateAlbumSchema } from '@studenthub/shared-schemas'

export class UpdateAlbumDto extends createZodDto(UpdateAlbumSchema) {}
