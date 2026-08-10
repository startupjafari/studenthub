import { forwardRef, Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { FilesModule } from '../files/files.module'
import { UserService } from './users.service'
import { UsersController } from './users.controller'
import { AvatarThumbnailProcessor } from './avatar-thumbnail.processor'

// forwardRef(AuthModule): разрешённое кольцо Auth ↔ Users (§2.1).
// FilesModule даёт FileService для загрузки/удаления аватара (задача 4.3).
// AvatarThumbnailProcessor — воркер очереди file-processing (генерация превью).
@Module({
  imports: [forwardRef(() => AuthModule), FilesModule],
  controllers: [UsersController],
  providers: [UserService, AvatarThumbnailProcessor],
  exports: [UserService],
})
export class UsersModule {}
