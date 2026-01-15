import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { FileUploadService } from '../../common/services/file-upload.service';
import { MediaType } from '@prisma/client';

@Injectable()
export class MediaService {
  constructor(
    private prisma: PrismaService,
    private fileUpload: FileUploadService,
  ) {}

  /**
   * Upload media file
   */
  async uploadMedia(userId: string, file: Express.Multer.File, type: MediaType) {
    // Validate file based on type
    this.validateMediaFile(file, type);

    // Process file based on type
    let processedBuffer = file.buffer;
    let mimeType = file.mimetype;

    if (type === MediaType.IMAGE) {
      // Process and optimize image
      processedBuffer = await this.fileUpload.processImage(file, {
        width: 1920,
        height: 1920,
        quality: 85,
        format: 'webp',
      });
      mimeType = 'image/webp';
    }

    // Determine folder based on type
    const folder = this.getFolderForType(type);

    // Upload to S3
    const fileToUpload = {
      ...file,
      buffer: processedBuffer,
      mimetype: mimeType,
    };

    const url = await this.fileUpload.uploadFile(fileToUpload, folder);

    // Save to database
    const media = await this.prisma.media.create({
      data: {
        url,
        type,
        size: processedBuffer.length,
        mimeType,
      },
    });

    return media;
  }

  /**
   * Get media by ID (returns signed URL)
   */
  async getMedia(id: string, expiresIn: number = 3600) {
    const media = await this.prisma.media.findUnique({
      where: { id },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    // Generate signed URL for temporary access
    const signedUrl = await this.fileUpload.getSignedUrl(media.url, expiresIn);

    return {
      ...media,
      signedUrl,
    };
  }

  /**
   * Delete media (only owner or admin)
   */
  async deleteMedia(id: string, userId: string) {
    const media = await this.prisma.media.findUnique({
      where: { id },
      include: {
        posts: {
          select: { authorId: true },
        },
        comments: {
          select: { authorId: true },
        },
        stories: {
          select: { authorId: true },
        },
        groupMessages: {
          select: { senderId: true },
        },
        messages: {
          select: { senderId: true },
        },
      },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    // Check ownership
    const isOwner =
      media.posts.some((p) => p.authorId === userId) ||
      media.comments.some((c) => c.authorId === userId) ||
      media.stories.some((s) => s.authorId === userId) ||
      media.groupMessages.some((gm) => gm.senderId === userId) ||
      media.messages.some((m) => m.senderId === userId);

    if (!isOwner) {
      // Check if user is admin
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (user?.role !== 'SUPER_ADMIN' && user?.role !== 'UNIVERSITY_ADMIN') {
        throw new ForbiddenException('You can only delete your own media');
      }
    }

    // Delete from S3
    await this.fileUpload.deleteFile(media.url);

    // Delete from database
    await this.prisma.media.delete({
      where: { id },
    });

    return { message: 'Media deleted successfully' };
  }

  /**
   * Validate media file based on type
   */
  private validateMediaFile(file: Express.Multer.File, type: MediaType) {
    const maxSizes: Record<MediaType, number> = {
      IMAGE: 10 * 1024 * 1024, // 10MB
      VIDEO: 100 * 1024 * 1024, // 100MB
      AUDIO: 50 * 1024 * 1024, // 50MB
      DOCUMENT: 20 * 1024 * 1024, // 20MB
      FILE: 50 * 1024 * 1024, // 50MB
    };

    const allowedTypes: Record<MediaType, string[]> = {
      IMAGE: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      VIDEO: ['video/mp4', 'video/webm', 'video/quicktime'],
      AUDIO: ['audio/mpeg', 'audio/wav', 'audio/ogg'],
      DOCUMENT: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      FILE: ['application/octet-stream'],
    };

    if (!this.fileUpload.validateFileType(file, allowedTypes[type])) {
      throw new BadRequestException(
        `Invalid file type for ${type}. Allowed types: ${allowedTypes[type].join(', ')}`,
      );
    }

    if (!this.fileUpload.validateFileSize(file, maxSizes[type])) {
      throw new BadRequestException(
        `File size exceeds limit for ${type}. Max size: ${maxSizes[type] / 1024 / 1024}MB`,
      );
    }
  }

  /**
   * Get folder name for media type
   */
  private getFolderForType(type: MediaType): string {
    const folders: Record<MediaType, string> = {
      IMAGE: 'images',
      VIDEO: 'videos',
      AUDIO: 'audio',
      DOCUMENT: 'documents',
      FILE: 'files',
    };

    return folders[type];
  }
}
