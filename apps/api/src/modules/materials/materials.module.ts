import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { MaterialsService } from './materials.service'
import { MaterialsController } from './materials.controller'

// Учебные материалы (docs/PROJECT.md §12, Ф12). Владеет Material; файлы — бакет materials через FileService.
@Module({
  imports: [FilesModule],
  controllers: [MaterialsController],
  providers: [MaterialsService],
  exports: [MaterialsService],
})
export class MaterialsModule {}
