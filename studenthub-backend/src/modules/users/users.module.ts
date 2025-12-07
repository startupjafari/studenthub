import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { FileUploadService } from '../../common/services/file-upload.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, PrismaService, CacheService, FileUploadService],
  exports: [UsersService],
})
export class UsersModule {}





