import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import {
  CreateGroupDto,
  UpdateGroupDto,
  AddMemberDto,
  UpdateMemberRoleDto,
  GetMembersDto,
} from './dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { UserRole, GroupRole } from '@prisma/client';

@Injectable()
export class GroupsService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  /**
   * Create group (only TEACHER)
   */
  async createGroup(userId: string, dto: CreateGroupDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { teacher: true },
    });

    if (!user || user.role !== UserRole.TEACHER) {
      throw new ForbiddenException('Only teachers can create groups');
    }

    // Check if university exists
    const university = await this.prisma.university.findUnique({
      where: { id: dto.universityId },
    });

    if (!university) {
      throw new NotFoundException('University not found');
    }

    // Create group and add creator as ADMIN
    const group = await this.prisma.$transaction(async (tx) => {
      const newGroup = await tx.group.create({
        data: {
          name: dto.name,
          description: dto.description,
          universityId: dto.universityId,
          creatorId: userId,
        },
      });

      // Add creator as ADMIN
      await tx.groupMember.create({
        data: {
          groupId: newGroup.id,
          userId,
          role: GroupRole.ADMIN,
          studentId: (user as any).student?.id || null,
        },
      });

      return newGroup;
    });

    // Invalidate cache
    await this.cache.deletePattern(`groups:${userId}*`);

    return this.getGroupById(group.id, userId);
  }

  /**
   * Get user's groups
   */
  async getMyGroups(userId: string) {
    const cacheKey = `groups:${userId}`;
    const cached = await this.cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const groups = await this.prisma.group.findMany({
      where: {
        OR: [
          { creatorId: userId },
          {
            members: {
              some: {
                userId,
              },
            },
          },
        ],
        isArchived: false,
      },
      include: {
        university: {
          select: {
            id: true,
            name: true,
            shortName: true,
          },
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            members: true,
            messages: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Cache for 10 minutes
    await this.cache.set(cacheKey, groups, 600);

    return groups;
  }

  /**
   * Get group by ID (only members)
   */
  async getGroupById(groupId: string, userId: string) {
    // Check if user is a member
    const membership = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        university: {
          select: {
            id: true,
            name: true,
            shortName: true,
          },
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        teachers: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
              },
            },
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
              },
            },
          },
        },
        _count: {
          select: {
            members: true,
            messages: true,
          },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    return group;
  }

  /**
   * Update group (only ADMIN)
   */
  async updateGroup(groupId: string, userId: string, dto: UpdateGroupDto) {
    const membership = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    if (!membership || membership.role !== GroupRole.ADMIN) {
      throw new ForbiddenException('Only group admins can update the group');
    }

    const updated = await this.prisma.group.update({
      where: { id: groupId },
      data: dto,
      include: {
        university: {
          select: {
            id: true,
            name: true,
            shortName: true,
          },
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            members: true,
            messages: true,
          },
        },
      },
    });

    // Invalidate cache
    await this.cache.deletePattern(`groups:*`);

    return updated;
  }

  /**
   * Delete group (only creator)
   */
  async deleteGroup(groupId: string, userId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    if (group.creatorId !== userId) {
      throw new ForbiddenException('Only the creator can delete the group');
    }

    await this.prisma.group.delete({
      where: { id: groupId },
    });

    // Invalidate cache
    await this.cache.deletePattern(`groups:*`);

    return { message: 'Group deleted successfully' };
  }

  /**
   * Add member to group (only ADMIN/TEACHER)
   */
  async addMember(groupId: string, userId: string, dto: AddMemberDto) {
    const membership = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    if (membership.role !== GroupRole.ADMIN && membership.role !== GroupRole.MODERATOR) {
      // Check if user is a teacher
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (user?.role !== UserRole.TEACHER) {
        throw new ForbiddenException('Only admins, moderators, and teachers can add members');
      }
    }

    // Check if user is already a member
    const existing = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: dto.userId,
        },
      },
    });

    if (existing) {
      throw new BadRequestException('User is already a member of this group');
    }

    // Get user's student record if exists
    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      include: { student: true },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const newMember = await this.prisma.groupMember.create({
      data: {
        groupId,
        userId: dto.userId,
        role: dto.role || GroupRole.MEMBER,
        studentId: targetUser.student?.id,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Create notification
    await this.createNotification(dto.userId, {
      type: 'GROUP_INVITE',
      title: 'Group Invitation',
      message: 'You have been added to a group',
      data: {
        groupId,
        addedBy: userId,
      },
    });

    // Invalidate cache
    await this.cache.deletePattern(`groups:*`);

    return newMember;
  }

  /**
   * Get group members
   */
  async getMembers(groupId: string, userId: string, dto: GetMembersDto) {
    // Check if user is a member
    const membership = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    const [members, total] = await Promise.all([
      this.prisma.groupMember.findMany({
        where: { groupId },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              role: true,
            },
          },
        },
        skip: dto.skip,
        take: dto.take,
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.groupMember.count({ where: { groupId } }),
    ]);

    return new PaginatedResponse(members, total, dto);
  }

  /**
   * Remove member from group (only ADMIN)
   */
  async removeMember(groupId: string, memberUserId: string, adminUserId: string) {
    const adminMembership = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: adminUserId,
        },
      },
    });

    if (!adminMembership || adminMembership.role !== GroupRole.ADMIN) {
      throw new ForbiddenException('Only group admins can remove members');
    }

    const member = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: memberUserId,
        },
      },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    await this.prisma.groupMember.delete({
      where: {
        groupId_userId: {
          groupId,
          userId: memberUserId,
        },
      },
    });

    // Invalidate cache
    await this.cache.deletePattern(`groups:*`);

    return { message: 'Member removed successfully' };
  }

  /**
   * Update member role (only ADMIN)
   */
  async updateMemberRole(
    groupId: string,
    memberUserId: string,
    adminUserId: string,
    dto: UpdateMemberRoleDto,
  ) {
    const adminMembership = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: adminUserId,
        },
      },
    });

    if (!adminMembership || adminMembership.role !== GroupRole.ADMIN) {
      throw new ForbiddenException('Only group admins can update member roles');
    }

    const updated = await this.prisma.groupMember.update({
      where: {
        groupId_userId: {
          groupId,
          userId: memberUserId,
        },
      },
      data: { role: dto.role },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Invalidate cache
    await this.cache.deletePattern(`groups:*`);

    return updated;
  }

  /**
   * Helper: Create notification
   */
  private async createNotification(
    recipientId: string,
    data: {
      type: string;
      title: string;
      message: string;
      data?: any;
    },
  ) {
    await this.prisma.notification.create({
      data: {
        recipientId,
        type: data.type as any,
        title: data.title,
        message: data.message,
        data: data.data || {},
      },
    });
  }
}
