import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as AWS from 'aws-sdk';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

export interface ImageOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
}

@Injectable()
export class FileUploadService {
  private s3: AWS.S3;
  private bucketName: string;

  constructor(private configService: ConfigService) {
    this.s3 = new AWS.S3({
      accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
      region: this.configService.get<string>('AWS_REGION') || 'us-east-1',
    });
    this.bucketName =
      this.configService.get<string>('AWS_S3_BUCKET') || 'studenthub';
  }

  /**
   * Upload file to S3
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string,
  ): Promise<string> {
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${folder}/${uuidv4()}.${fileExtension}`;

    const params: AWS.S3.PutObjectRequest = {
      Bucket: this.bucketName,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    try {
      await this.s3.putObject(params).promise();
      return `https://${this.bucketName}.s3.amazonaws.com/${fileName}`;
    } catch (error) {
      throw new BadRequestException(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * Delete file from S3
   */
  async deleteFile(key: string): Promise<void> {
    // Extract key from full URL if provided
    const s3Key = key.includes('amazonaws.com/')
      ? key.split('amazonaws.com/')[1]
      : key;

    const params: AWS.S3.DeleteObjectRequest = {
      Bucket: this.bucketName,
      Key: s3Key,
    };

    try {
      await this.s3.deleteObject(params).promise();
    } catch (error) {
      console.error(`Failed to delete file: ${error.message}`);
    }
  }

  /**
   * Get signed URL for temporary access
   */
  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const s3Key = key.includes('amazonaws.com/')
      ? key.split('amazonaws.com/')[1]
      : key;

    const params = {
      Bucket: this.bucketName,
      Key: s3Key,
      Expires: expiresIn,
    };

    try {
      return this.s3.getSignedUrl('getObject', params);
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate signed URL: ${error.message}`,
      );
    }
  }

  /**
   * Process and optimize image
   */
  async processImage(
    file: Express.Multer.File,
    options: ImageOptions = {},
  ): Promise<Buffer> {
    const {
      width = 500,
      height = 500,
      quality = 80,
      format = 'webp',
    } = options;

    try {
      let image = sharp(file.buffer);

      // Resize with aspect ratio preservation
      image = image.resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true,
      });

      // Convert and optimize based on format
      switch (format) {
        case 'jpeg':
          image = image.jpeg({ quality });
          break;
        case 'png':
          image = image.png({ quality });
          break;
        case 'webp':
          image = image.webp({ quality });
          break;
      }

      return await image.toBuffer();
    } catch (error) {
      throw new BadRequestException(
        `Failed to process image: ${error.message}`,
      );
    }
  }

  /**
   * Validate file type
   */
  validateFileType(
    file: Express.Multer.File,
    allowedTypes: string[],
  ): boolean {
    return allowedTypes.includes(file.mimetype);
  }

  /**
   * Validate file size (in bytes)
   */
  validateFileSize(file: Express.Multer.File, maxSize: number): boolean {
    return file.size <= maxSize;
  }
}

