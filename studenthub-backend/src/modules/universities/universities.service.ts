import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import {
  CreateUniversityDto,
  UpdateUniversityDto,
  AssignAdminDto,
  SearchUniversitiesDto,
} from './dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { UserRole, AdminRole } from '@prisma/client';

@Injectable()
export class UniversitiesService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  /**
   * Create university (SUPER_ADMIN only)
   */
  async createUniversity(dto: CreateUniversityDto, adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });

    if (!admin || admin.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only super admins can create universities');
    }

    // Check if university with same name exists
    const existing = await this.prisma.university.findUnique({
      where: { name: dto.name },
    });

    if (existing) {
      throw new BadRequestException('University with this name already exists');
    }

    // Check if email is provided and unique
    if (dto.email) {
      const existingEmail = await this.prisma.university.findUnique({
        where: { email: dto.email },
      });

      if (existingEmail) {
        throw new BadRequestException('University with this email already exists');
      }
    }

    const university = await this.prisma.university.create({
      data: {
        name: dto.name,
        shortName: dto.shortName,
        email: dto.email,
        country: dto.country,
        city: dto.city,
        address: dto.address,
        website: dto.website,
        description: dto.description,
        founded: dto.founded,
      },
    });

    return university;
  }

  /**
   * Get list of universities (public)
   */
  async getUniversities(dto: SearchUniversitiesDto) {
    const where: any = {};

    if (dto.country) {
      where.country = { contains: dto.country, mode: 'insensitive' };
    }

    if (dto.city) {
      where.city = { contains: dto.city, mode: 'insensitive' };
    }

    const [universities, total] = await Promise.all([
      this.prisma.university.findMany({
        where,
        select: {
          id: true,
          name: true,
          shortName: true,
          logo: true,
          country: true,
          city: true,
          studentCount: true,
          teacherCount: true,
          founded: true,
        },
        skip: dto.skip,
        take: dto.take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.university.count({ where }),
    ]);

    return new PaginatedResponse(universities, total, dto);
  }

  /**
   * Get university details (public)
   */
  async getUniversityById(id: string) {
    const university = await this.prisma.university.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: {
              where: {
                role: UserRole.STUDENT,
                deletedAt: null,
              },
            },
            admins: true,
            groups: {
              where: {
                isArchived: false,
              },
            },
          },
        },
      },
    });

    if (!university) {
      throw new NotFoundException('University not found');
    }

    // Get teacher count
    const teacherCount = await this.prisma.teacher.count({
      where: {
        user: {
          universityId: id,
          deletedAt: null,
        },
      },
    });

    return {
      ...university,
      stats: {
        totalStudents: university._count.users,
        totalTeachers: teacherCount,
        totalGroups: university._count.groups,
      },
    };
  }

  /**
   * Update university (SUPER_ADMIN only)
   */
  async updateUniversity(
    id: string,
    dto: UpdateUniversityDto,
    adminId: string,
  ) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });

    if (!admin || admin.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only super admins can update universities');
    }

    const university = await this.prisma.university.findUnique({
      where: { id },
    });

    if (!university) {
      throw new NotFoundException('University not found');
    }

    // Check if name/email conflicts
    if (dto.name && dto.name !== university.name) {
      const existing = await this.prisma.university.findUnique({
        where: { name: dto.name },
      });

      if (existing) {
        throw new BadRequestException('University with this name already exists');
      }
    }

    if (dto.email && dto.email !== university.email) {
      const existing = await this.prisma.university.findUnique({
        where: { email: dto.email },
      });

      if (existing) {
        throw new BadRequestException(
          'University with this email already exists',
        );
      }
    }

    const updated = await this.prisma.university.update({
      where: { id },
      data: dto,
    });

    return updated;
  }

  /**
   * Assign admin to university (SUPER_ADMIN only)
   */
  async assignAdmin(
    universityId: string,
    dto: AssignAdminDto,
    adminId: string,
  ) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });

    if (!admin || admin.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only super admins can assign admins');
    }

    const university = await this.prisma.university.findUnique({
      where: { id: universityId },
    });

    if (!university) {
      throw new NotFoundException('University not found');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if user is already an admin of this university
    const existingAdmin = await this.prisma.universityAdmin.findUnique({
      where: {
        universityId_userId: {
          universityId,
          userId: dto.userId,
        },
      },
    });

    if (existingAdmin) {
      throw new BadRequestException('User is already an admin of this university');
    }

    // Transaction: Create UniversityAdmin, Update User role and universityId
    await this.prisma.$transaction(async (tx) => {
      // Create UniversityAdmin record
      await tx.universityAdmin.create({
        data: {
          userId: dto.userId,
          universityId,
          role: dto.role,
        },
      });

      // Update User role and universityId
      await tx.user.update({
        where: { id: dto.userId },
        data: {
          role: UserRole.UNIVERSITY_ADMIN,
          universityId,
        },
      });
    });

    // Create notification
    await this.createNotification(dto.userId, {
      type: 'ROLE_CHANGED',
      title: 'Role Changed',
      message: `You have been assigned as ${dto.role} of ${university.name}`,
      data: {
        newRole: UserRole.UNIVERSITY_ADMIN,
        universityId,
        universityName: university.name,
      },
    });

    // Invalidate cache
    await this.cache.invalidateUserCache(dto.userId);

    return { message: 'Admin assigned successfully' };
  }

  /**
   * Helper: Create notification
   */
  private async createNotification(
    userId: string,
    data: {
      type: string;
      title: string;
      message: string;
      data?: any;
    },
  ) {
    await this.prisma.notification.create({
      data: {
        recipientId: userId,
        type: data.type as any,
        title: data.title,
        message: data.message,
        data: data.data || {},
      },
    });
  }
}





