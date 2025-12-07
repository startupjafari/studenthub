import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { FileUploadService } from '../../common/services/file-upload.service';
import { UploadDocumentDto } from './dto';
import { DocumentType, DocumentStatus } from '@prisma/client';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private fileUpload: FileUploadService,
  ) {}

  async uploadDocument(userId: string, file: Express.Multer.File, dto: UploadDocumentDto) {
    // Validate file
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!this.fileUpload.validateFileType(file, allowedTypes)) {
      throw new BadRequestException('Invalid file type. Only PDF, JPEG, and PNG are allowed.');
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (!this.fileUpload.validateFileSize(file, maxSize)) {
      throw new BadRequestException('File size exceeds 10MB limit.');
    }

    // Upload to S3
    const fileUrl = await this.fileUpload.uploadFile(file, 'documents');

    // Save to database
    const document = await this.prisma.document.create({
      data: {
        ownerId: userId,
        type: dto.type,
        fileName: file.originalname,
        fileUrl,
        fileSize: file.size,
        status: DocumentStatus.PENDING,
      },
    });

    return document;
  }

  async getMyDocuments(userId: string) {
    return this.prisma.document.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDocumentById(id: string, userId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Check if user is owner or admin
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (document.ownerId !== userId && user?.role !== 'SUPER_ADMIN' && user?.role !== 'UNIVERSITY_ADMIN') {
      throw new ForbiddenException('Access denied');
    }

    return document;
  }

  async deleteDocument(id: string, userId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (document.ownerId !== userId) {
      throw new ForbiddenException('You can only delete your own documents');
    }

    // Delete from S3
    await this.fileUpload.deleteFile(document.fileUrl);

    // Delete from database
    await this.prisma.document.delete({
      where: { id },
    });

    return { message: 'Document deleted successfully' };
  }

  async verifyDocument(id: string, adminId: string) {
    const admin = await this.prisma.universityAdmin.findUnique({
      where: { userId: adminId },
    });

    if (!admin) {
      throw new ForbiddenException('Only admins can verify documents');
    }

    const document = await this.prisma.document.update({
      where: { id },
      data: { status: DocumentStatus.VERIFIED },
    });

    // Create notification
    await this.prisma.notification.create({
      data: {
        recipientId: document.ownerId,
        type: 'DOCUMENT_UPDATED',
        title: 'Document Verified',
        message: 'Your document has been verified',
        data: { documentId: id },
      },
    });

    return document;
  }

  async rejectDocument(id: string, adminId: string) {
    const admin = await this.prisma.universityAdmin.findUnique({
      where: { userId: adminId },
    });

    if (!admin) {
      throw new ForbiddenException('Only admins can reject documents');
    }

    const document = await this.prisma.document.update({
      where: { id },
      data: { status: DocumentStatus.REJECTED },
    });

    // Create notification
    await this.prisma.notification.create({
      data: {
        recipientId: document.ownerId,
        type: 'DOCUMENT_UPDATED',
        title: 'Document Rejected',
        message: 'Your document has been rejected',
        data: { documentId: id },
      },
    });

    return document;
  }
}





