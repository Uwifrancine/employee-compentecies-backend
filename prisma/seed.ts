import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: "admin@company.com" } });
  if (existing) {
    console.log("Admin already exists, skipping seed.");
    return;
  }

  const passwordHash = await bcrypt.hash("Admin@1234", 12);

  const admin = await prisma.user.create({
    data: {
      email: "admin@company.com",
      passwordHash,
      fullName: "System Admin",
      mustChangePassword: true,
      roles: { create: [{ role: "admin" }] },
    },
  });

  console.log(`Admin created: ${admin.email}  (temporary password: Admin@1234)`);
  console.log("Change this password immediately after first login.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
