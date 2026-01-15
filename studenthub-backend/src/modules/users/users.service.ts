import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { FileUploadService } from '../../common/services/file-upload.service';
import { UpdateUserDto, UpdateStudentDto, UpdateTeacherDto } from './dto';
import { SearchUsersDto } from './dto/search-users.dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { User, UserRole } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    private fileUpload: FileUploadService,
  ) {}

  /**
   * Get current user with relations
   */
  async getCurrentUser(userId: string) {
    const cacheKey = `user:${userId}`;
    const cached = await this.cache.get<User>(cacheKey);

    if (cached) {
      return cached;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        student: true,
        teacher: true,
        universityAdmin: true,
        university: {
          select: {
            id: true,
            name: true,
            shortName: true,
            logo: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.cache.set(cacheKey, user, 600); // 10 minutes

    return user;
  }

  /**
   * Get user profile (public)
   */
  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatar: true,
        bio: true,
        birthDate: true,
        role: true,
        student: {
          select: {
            studentId: true,
            academicStatus: true,
          },
        },
        teacher: {
          select: {
            department: true,
            specialization: true,
          },
        },
        university: {
          select: {
            id: true,
            name: true,
            shortName: true,
            logo: true,
          },
        },
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * Update user profile
   */
  async updateProfile(userId: string, dto: UpdateUserDto | UpdateStudentDto | UpdateTeacherDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { student: true, teacher: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Update User fields
    const userData: any = {};
    if (dto.firstName) userData.firstName = dto.firstName;
    if (dto.lastName) userData.lastName = dto.lastName;
    if (dto.bio !== undefined) userData.bio = dto.bio;
    if (dto.birthDate) userData.birthDate = new Date(dto.birthDate);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: userData,
      include: {
        student: true,
        teacher: true,
        universityAdmin: true,
      },
    });

    // Update role-specific fields
    if (user.role === UserRole.STUDENT && user.student) {
      const studentDto = dto as UpdateStudentDto;
      if (studentDto.studentId || studentDto.expectedGraduation) {
        await this.prisma.student.update({
          where: { userId },
          data: {
            ...(studentDto.studentId && { studentId: studentDto.studentId }),
            ...(studentDto.expectedGraduation && {
              expectedGraduation: new Date(studentDto.expectedGraduation),
            }),
          },
        });
      }
    }

    if (user.role === UserRole.TEACHER && user.teacher) {
      const teacherDto = dto as UpdateTeacherDto;
      if (teacherDto.department || teacherDto.specialization || teacherDto.qualifications) {
        await this.prisma.teacher.update({
          where: { userId },
          data: {
            ...(teacherDto.department && { department: teacherDto.department }),
            ...(teacherDto.specialization && {
              specialization: teacherDto.specialization,
            }),
            ...(teacherDto.qualifications && {
              qualifications: teacherDto.qualifications,
            }),
          },
        });
      }
    }

    // Invalidate cache
    await this.cache.invalidateUserCache(userId);

    return this.getCurrentUser(userId);
  }

  /**
   * Search users
   */
  async searchUsers(dto: SearchUsersDto, currentUserId: string) {
    const where: any = {
      deletedAt: null,
    };

    if (dto.q) {
      where.OR = [
        { firstName: { contains: dto.q, mode: 'insensitive' } },
        { lastName: { contains: dto.q, mode: 'insensitive' } },
        { email: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    if (dto.role) {
      where.role = dto.role;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatar: true,
          bio: true,
          role: true,
          student: {
            select: {
              studentId: true,
              academicStatus: true,
            },
          },
          teacher: {
            select: {
              department: true,
              specialization: true,
            },
          },
          university: {
            select: {
              id: true,
              name: true,
              shortName: true,
            },
          },
          createdAt: true,
        },
        skip: dto.skip,
        take: dto.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return new PaginatedResponse(users, total, dto);
  }

  /**
   * Upload avatar
   */
  async uploadAvatar(userId: string, file: Express.Multer.File) {
    // Validate file
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!this.fileUpload.validateFileType(file, allowedTypes)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP are allowed.');
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (!this.fileUpload.validateFileSize(file, maxSize)) {
      throw new BadRequestException('File size exceeds 5MB limit.');
    }

    // Process image
    const processedImage = await this.fileUpload.processImage(file, {
      width: 500,
      height: 500,
      quality: 80,
      format: 'webp',
    });

    // Upload to S3
    const fileToUpload = {
      ...file,
      buffer: processedImage,
    };

    const avatarUrl = await this.fileUpload.uploadFile(fileToUpload, 'avatars');

    // Delete old avatar if exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true },
    });

    if (user?.avatar) {
      await this.fileUpload.deleteFile(user.avatar);
    }

    // Update user
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatar: avatarUrl },
    });

    // Invalidate cache
    await this.cache.invalidateUserCache(userId);

    return { avatarUrl };
  }

  /**
   * Delete user account (soft delete)
   */
  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        status: 'DELETED',
      },
    });

    // Invalidate cache
    await this.cache.invalidateUserCache(userId);

    return { message: 'Account deleted successfully' };
  }
}
