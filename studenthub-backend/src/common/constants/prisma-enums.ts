// Temporary enums until Prisma Client is generated (run: npx prisma generate)
// After generation, replace these imports with: import { UserRole, UserStatus } from '@prisma/client';

export const UserRole = {
  STUDENT: 'STUDENT' as const,
  TEACHER: 'TEACHER' as const,
  UNIVERSITY_ADMIN: 'UNIVERSITY_ADMIN' as const,
  SUPER_ADMIN: 'SUPER_ADMIN' as const,
};

export const UserStatus = {
  ACTIVE: 'ACTIVE' as const,
  INACTIVE: 'INACTIVE' as const,
  SUSPENDED: 'SUSPENDED' as const,
  DELETED: 'DELETED' as const,
};

export type UserRoleType = typeof UserRole[keyof typeof UserRole];
export type UserStatusType = typeof UserStatus[keyof typeof UserStatus];

