import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { AssignTeacherDto, AdminSearchUsersDto, SearchTeachersDto, SearchStudentsDto } from './dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { UserRole, TeacherRegStatus } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  /**
   * Search users for role assignment (UNIVERSITY_ADMIN only)
   */
  async searchUsersForAssignment(dto: AdminSearchUsersDto, adminId: string) {
    const admin = await this.prisma.universityAdmin.findUnique({
      where: { userId: adminId },
    });

    if (!admin) {
      throw new ForbiddenException('Only university admins can access this');
    }

    const where: any = {
      deletedAt: null,
      universityId: admin.universityId,
    };

    if (dto.q) {
      where.OR = [
        { email: { contains: dto.q, mode: 'insensitive' } },
        { firstName: { contains: dto.q, mode: 'insensitive' } },
        { lastName: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          avatar: true,
          role: true,
          student: {
            select: {
              studentId: true,
              academicStatus: true,
            },
          },
          teacher: {
            select: {
              employeeId: true,
              department: true,
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
   * Assign teacher role to user
   */
  async assignTeacher(userId: string, dto: AssignTeacherDto, adminId: string) {
    const admin = await this.prisma.universityAdmin.findUnique({
      where: { userId: adminId },
    });

    if (!admin) {
      throw new ForbiddenException('Only university admins can assign teachers');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { student: true, teacher: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.universityId !== admin.universityId) {
      throw new ForbiddenException('User must belong to the same university as admin');
    }

    if (user.role === UserRole.TEACHER) {
      throw new BadRequestException('User is already a teacher');
    }

    // Check if employeeId already exists
    const existingTeacher = await this.prisma.teacher.findUnique({
      where: { employeeId: dto.employeeId },
    });

    if (existingTeacher) {
      throw new BadRequestException('Employee ID already exists');
    }

    // Transaction: Create Teacher, Update User role, Delete Student
    await this.prisma.$transaction(async (tx) => {
      // Create Teacher record
      await tx.teacher.create({
        data: {
          userId: user.id,
          employeeId: dto.employeeId,
          department: dto.department,
          specialization: dto.specialization,
          qualifications: dto.qualifications,
          registrationStatus: TeacherRegStatus.APPROVED,
          registeredAt: new Date(),
        },
      });

      // Update User role
      await tx.user.update({
        where: { id: userId },
        data: { role: UserRole.TEACHER },
      });

      // Delete Student record if exists
      if (user.student) {
        await tx.student.delete({
          where: { userId },
        });
      }
    });

    // Create notification
    await this.createNotification(userId, {
      type: 'ROLE_CHANGED',
      title: 'Role Changed',
      message: 'You have been assigned the role of Teacher',
      data: {
        newRole: UserRole.TEACHER,
        department: dto.department,
      },
    });

    // Invalidate cache
    await this.cache.invalidateUserCache(userId);

    return { message: 'Teacher role assigned successfully' };
  }

  /**
   * Remove teacher role
   */
  async removeTeacher(teacherId: string, adminId: string) {
    const admin = await this.prisma.universityAdmin.findUnique({
      where: { userId: adminId },
    });

    if (!admin) {
      throw new ForbiddenException('Only university admins can remove teachers');
    }

    const teacher = await this.prisma.teacher.findUnique({
      where: { id: teacherId },
      include: { user: true },
    });

    if (!teacher) {
      throw new NotFoundException('Teacher not found');
    }

    if (teacher.user.universityId !== admin.universityId) {
      throw new ForbiddenException('Teacher must belong to the same university as admin');
    }

    // Transaction: Delete Teacher, Update User role, Create Student
    await this.prisma.$transaction(async (tx) => {
      // Delete Teacher record
      await tx.teacher.delete({
        where: { id: teacherId },
      });

      // Update User role
      await tx.user.update({
        where: { id: teacher.userId },
        data: { role: UserRole.STUDENT },
      });

      // Create Student record
      await tx.student.create({
        data: {
          userId: teacher.userId,
          studentId: `STU${Date.now()}`, // Generate temporary student ID
          enrollmentDate: new Date(),
          academicStatus: 'ACTIVE',
        },
      });
    });

    // Create notification
    await this.createNotification(teacher.userId, {
      type: 'ROLE_CHANGED',
      title: 'Role Changed',
      message: 'Your teacher role has been removed',
      data: {
        newRole: UserRole.STUDENT,
      },
    });

    // Invalidate cache
    await this.cache.invalidateUserCache(teacher.userId);

    return { message: 'Teacher role removed successfully' };
  }

  /**
   * Get list of teachers
   */
  async getTeachers(dto: SearchTeachersDto, adminId: string) {
    const admin = await this.prisma.universityAdmin.findUnique({
      where: { userId: adminId },
    });

    if (!admin) {
      throw new ForbiddenException('Only university admins can access this');
    }

    const where: any = {
      user: {
        universityId: admin.universityId,
        deletedAt: null,
      },
      registrationStatus: TeacherRegStatus.APPROVED,
    };

    if (dto.department) {
      where.department = { contains: dto.department, mode: 'insensitive' };
    }

    if (dto.search) {
      where.OR = [
        { user: { firstName: { contains: dto.search, mode: 'insensitive' } } },
        { user: { lastName: { contains: dto.search, mode: 'insensitive' } } },
        { employeeId: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    const [teachers, total] = await Promise.all([
      this.prisma.teacher.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatar: true,
            },
          },
        },
        skip: dto.skip,
        take: dto.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.teacher.count({ where }),
    ]);

    return new PaginatedResponse(teachers, total, dto);
  }

  /**
   * Get list of students
   */
  async getStudents(dto: SearchStudentsDto, adminId: string) {
    const admin = await this.prisma.universityAdmin.findUnique({
      where: { userId: adminId },
    });

    if (!admin) {
      throw new ForbiddenException('Only university admins can access this');
    }

    const where: any = {
      user: {
        universityId: admin.universityId,
        deletedAt: null,
      },
    };

    if (dto.academicStatus) {
      where.academicStatus = dto.academicStatus;
    }

    if (dto.search) {
      where.OR = [
        { user: { firstName: { contains: dto.search, mode: 'insensitive' } } },
        { user: { lastName: { contains: dto.search, mode: 'insensitive' } } },
        { studentId: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    const [students, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatar: true,
            },
          },
        },
        skip: dto.skip,
        take: dto.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.student.count({ where }),
    ]);

    return new PaginatedResponse(students, total, dto);
  }

  /**
   * Get university analytics
   */
  async getAnalytics(adminId: string) {
    const admin = await this.prisma.universityAdmin.findUnique({
      where: { userId: adminId },
    });

    if (!admin) {
      throw new ForbiddenException('Only university admins can access this');
    }

    const [totalStudents, totalTeachers, totalGroups, activeStudents, graduatedStudents] =
      await Promise.all([
        this.prisma.student.count({
          where: {
            user: {
              universityId: admin.universityId,
              deletedAt: null,
            },
          },
        }),
        this.prisma.teacher.count({
          where: {
            user: {
              universityId: admin.universityId,
              deletedAt: null,
            },
            registrationStatus: TeacherRegStatus.APPROVED,
          },
        }),
        this.prisma.group.count({
          where: {
            universityId: admin.universityId,
            isArchived: false,
          },
        }),
        this.prisma.student.count({
          where: {
            user: {
              universityId: admin.universityId,
              deletedAt: null,
            },
            academicStatus: 'ACTIVE',
          },
        }),
        this.prisma.student.count({
          where: {
            user: {
              universityId: admin.universityId,
              deletedAt: null,
            },
            academicStatus: 'GRADUATED',
          },
        }),
      ]);

    return {
      totalStudents,
      totalTeachers,
      totalGroups,
      activeStudents,
      graduatedStudents,
    };
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
