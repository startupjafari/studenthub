import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UploadDocumentDto } from './dto';
import { User } from '@prisma/client';

@ApiTags('Documents')
@ApiBearerAuth()
@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload document',
    description: 'Uploads a document (PDF, JPEG, PNG). Max size: 10MB. Document status is set to PENDING until verified by admin.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        type: {
          type: 'string',
          enum: ['PASSPORT', 'ID_CARD', 'STUDENT_CARD', 'MEDICAL_CERTIFICATE', 'DIPLOMA', 'TRANSCRIPT', 'OTHER'],
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Document uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file type or size exceeds 10MB' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async uploadDocument(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.documentsService.uploadDocument(user.id, file, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get my documents',
    description: 'Returns list of all documents uploaded by the current user.',
  })
  @ApiResponse({ status: 200, description: 'Documents retrieved successfully' })
  async getMyDocuments(@CurrentUser() user: User) {
    return this.documentsService.getMyDocuments(user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get document by ID',
    description: 'Returns document details. Accessible to document owner or admins.',
  })
  @ApiParam({ name: 'id', description: 'Document ID', type: String })
  @ApiResponse({ status: 200, description: 'Document retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Access denied' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async getDocumentById(@Param('id') id: string, @CurrentUser() user: User) {
    return this.documentsService.getDocumentById(id, user.id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete document',
    description: 'Deletes a document from S3 and database. Only the document owner can delete their own documents.',
  })
  @ApiParam({ name: 'id', description: 'Document ID', type: String })
  @ApiResponse({ status: 200, description: 'Document deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You can only delete your own documents' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async deleteDocument(@Param('id') id: string, @CurrentUser() user: User) {
    return this.documentsService.deleteDocument(id, user.id);
  }

  @Post('admin/:id/verify')
  @UseGuards(RolesGuard)
  @Roles('UNIVERSITY_ADMIN')
  @ApiOperation({
    summary: 'Verify document (ADMIN only)',
    description: 'Verifies a document. Changes status to VERIFIED and sends notification to document owner.',
  })
  @ApiParam({ name: 'id', description: 'Document ID', type: String })
  @ApiResponse({ status: 200, description: 'Document verified successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only admins can verify documents' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async verifyDocument(@Param('id') id: string, @CurrentUser() user: User) {
    return this.documentsService.verifyDocument(id, user.id);
  }

  @Post('admin/:id/reject')
  @UseGuards(RolesGuard)
  @Roles('UNIVERSITY_ADMIN')
  @ApiOperation({
    summary: 'Reject document (ADMIN only)',
    description: 'Rejects a document. Changes status to REJECTED and sends notification to document owner.',
  })
  @ApiParam({ name: 'id', description: 'Document ID', type: String })
  @ApiResponse({ status: 200, description: 'Document rejected successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only admins can reject documents' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async rejectDocument(@Param('id') id: string, @CurrentUser() user: User) {
    return this.documentsService.rejectDocument(id, user.id);
  }
}

