import { Module } from '@nestjs/common'
import { FileService } from './file.service'
import { FilesController } from './files.controller'

// PrismaModule и MinioModule глобальные — отдельный импорт не нужен.
// FileService экспортируется для переиспользования (аватар 4.3, вложения, медиа).
@Module({
  controllers: [FilesController],
  providers: [FileService],
  exports: [FileService],
})
export class FilesModule {}
