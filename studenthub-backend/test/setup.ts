import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function cleanDatabase() {
  // Clean up test data
  // Add cleanup logic as needed
}

export async function closeDatabase() {
  await prisma.$disconnect();
}

export { prisma };

