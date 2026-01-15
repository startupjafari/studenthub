import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../common/services/prisma.service';
import { FileUploadService } from '../../common/services/file-upload.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, PrismaService, FileUploadService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
