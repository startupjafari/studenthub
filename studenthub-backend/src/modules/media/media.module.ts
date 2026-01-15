import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { PrismaService } from '../../common/services/prisma.service';
import { FileUploadService } from '../../common/services/file-upload.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, PrismaService, FileUploadService],
  exports: [MediaService],
})
export class MediaModule {}
