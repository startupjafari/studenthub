import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateScheduleDto, UpdateScheduleDto, GetSchedulesDto } from './dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

@Injectable()
export class SchedulesService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Create schedule for a group
   */
  async createSchedule(userId: string, dto: CreateScheduleDto) {
    // Verify group exists and user has permission
    const group = await this.prisma.group.findUnique({
      where: { id: dto.groupId },
      include: {
        members: {
          where: {
            userId,
            role: {
              in: ['ADMIN', 'MODERATOR'],
            },
          },
        },
        teachers: {
          include: {
            user: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    // Check if user is group admin/moderator or teacher
    const isAdmin = group.members.length > 0;
    const isTeacher = group.teachers.some((t) => t.user.id === userId);
    const isCreator = group.creatorId === userId;

    if (!isAdmin && !isTeacher && !isCreator) {
      throw new ForbiddenException(
        'Only group admins, moderators, or teachers can create schedules',
      );
    }

    // Create schedule
    const schedule = await this.prisma.groupSchedule.create({
      data: {
        groupId: dto.groupId,
        title: dto.title,
        description: dto.description,
        startTime: new Date(dto.startTime),
        endTime: dto.endTime ? new Date(dto.endTime) : null,
        location: dto.location,
        isOnline: dto.isOnline || false,
        meetingLink: dto.meetingLink,
        createdById: userId,
      },
      include: {
        group: {
          select: {
            id: true,
            name: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Get all group members
    const members = await this.prisma.groupMember.findMany({
      where: { groupId: dto.groupId },
      include: {
        user: {
          select: {
            id: true,
          },
        },
      },
    });

    // Send notifications to all group members
    await Promise.all(
      members.map((member) =>
        this.notificationsService.createNotification({
          recipientId: member.user.id,
          type: 'SCHEDULE_CREATED',
          title: 'Новое расписание в группе',
          message: `В группе "${group.name}" добавлено новое расписание: ${dto.title}`,
          data: {
            scheduleId: schedule.id,
            groupId: dto.groupId,
            groupName: group.name,
            title: dto.title,
            startTime: dto.startTime,
          },
        }),
      ),
    );

    return schedule;
  }

  /**
   * Update schedule
   */
  async updateSchedule(scheduleId: string, userId: string, dto: UpdateScheduleDto) {
    const schedule = await this.prisma.groupSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        group: {
          include: {
            members: {
              where: {
                userId,
                role: {
                  in: ['ADMIN', 'MODERATOR'],
                },
              },
            },
            teachers: {
              include: {
                user: {
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }

    // Check permissions
    const isAdmin = schedule.group.members.length > 0;
    const isTeacher = schedule.group.teachers.some((t) => t.user.id === userId);
    const isCreator = schedule.createdById === userId;

    if (!isAdmin && !isTeacher && !isCreator) {
      throw new ForbiddenException('Access denied');
    }

    // Update schedule
    const updateData: any = {};
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.startTime !== undefined) updateData.startTime = new Date(dto.startTime);
    if (dto.endTime !== undefined) updateData.endTime = dto.endTime ? new Date(dto.endTime) : null;
    if (dto.location !== undefined) updateData.location = dto.location;
    if (dto.isOnline !== undefined) updateData.isOnline = dto.isOnline;
    if (dto.meetingLink !== undefined) updateData.meetingLink = dto.meetingLink;

    const updatedSchedule = await this.prisma.groupSchedule.update({
      where: { id: scheduleId },
      data: updateData,
      include: {
        group: {
          select: {
            id: true,
            name: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Get all group members
    const members = await this.prisma.groupMember.findMany({
      where: { groupId: schedule.groupId },
      include: {
        user: {
          select: {
            id: true,
          },
        },
      },
    });

    // Send notifications to all group members
    await Promise.all(
      members.map((member) =>
        this.notificationsService.createNotification({
          recipientId: member.user.id,
          type: 'SCHEDULE_UPDATED',
          title: 'Расписание обновлено',
          message: `Расписание "${updatedSchedule.title}" в группе "${schedule.group.name}" было обновлено`,
          data: {
            scheduleId: updatedSchedule.id,
            groupId: schedule.groupId,
            groupName: schedule.group.name,
            title: updatedSchedule.title,
            startTime: updatedSchedule.startTime,
          },
        }),
      ),
    );

    return updatedSchedule;
  }

  /**
   * Get schedules
   */
  async getSchedules(userId: string, dto: GetSchedulesDto) {
    const where: any = {};

    if (dto.groupId) {
      // Verify user is member of the group
      const membership = await this.prisma.groupMember.findUnique({
        where: {
          groupId_userId: {
            groupId: dto.groupId,
            userId,
          },
        },
      });

      if (!membership) {
        throw new ForbiddenException('You are not a member of this group');
      }

      where.groupId = dto.groupId;
    } else {
      // Get all groups user is member of
      const userGroups = await this.prisma.groupMember.findMany({
        where: { userId },
        select: { groupId: true },
      });

      where.groupId = {
        in: userGroups.map((g) => g.groupId),
      };
    }

    if (dto.fromDate) {
      where.startTime = {
        gte: new Date(dto.fromDate),
      };
    }

    if (dto.toDate) {
      where.startTime = {
        ...where.startTime,
        lte: new Date(dto.toDate),
      };
    }

    const [schedules, total] = await Promise.all([
      this.prisma.groupSchedule.findMany({
        where,
        include: {
          group: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
        },
        orderBy: { startTime: 'asc' },
        skip: dto.skip,
        take: dto.take,
      }),
      this.prisma.groupSchedule.count({ where }),
    ]);

    return new PaginatedResponse(schedules, total, dto);
  }

  /**
   * Get schedule by ID
   */
  async getScheduleById(scheduleId: string, userId: string) {
    const schedule = await this.prisma.groupSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        group: {
          include: {
            members: {
              where: { userId },
            },
          },
        },
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }

    // Check if user is member
    if (schedule.group.members.length === 0) {
      throw new ForbiddenException('You are not a member of this group');
    }

    return schedule;
  }

  /**
   * Delete schedule
   */
  async deleteSchedule(scheduleId: string, userId: string) {
    const schedule = await this.prisma.groupSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        group: {
          include: {
            members: {
              where: {
                userId,
                role: {
                  in: ['ADMIN', 'MODERATOR'],
                },
              },
            },
            teachers: {
              include: {
                user: {
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }

    // Check permissions
    const isAdmin = schedule.group.members.length > 0;
    const isTeacher = schedule.group.teachers.some((t) => t.user.id === userId);
    const isCreator = schedule.createdById === userId;

    if (!isAdmin && !isTeacher && !isCreator) {
      throw new ForbiddenException('Access denied');
    }

    await this.prisma.groupSchedule.delete({
      where: { id: scheduleId },
    });

    return { message: 'Schedule deleted' };
  }
}
