import { createZodDto } from 'nestjs-zod'
import { SetBannerSchema } from '@studenthub/shared-schemas'

export class SetBannerDto extends createZodDto(SetBannerSchema) {}
