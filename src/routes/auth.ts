import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  jobTitleId: z.string().uuid().optional(),
  supervisorId: z.string().uuid().optional(),
  roles: z.array(z.enum(["admin", "employee", "hr"])).default(["employee"]),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

function signToken(userId: string, email: string, roles: string[]): string {
  const expiresIn = (process.env.JWT_EXPIRES_IN ?? "7d") as `${number}${"s" | "m" | "h" | "d" | "w"}`;
  return jwt.sign({ userId, email, roles }, process.env.JWT_SECRET!, { expiresIn });
}

// GET /api/auth/check-admin — public, used by login page to detect first-run
router.get("/check-admin", async (_req, res) => {
  const count = await prisma.userRole.count({ where: { role: "admin" } });
  res.json({ count });
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { roles: true },
  });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const roles = user.roles.map((r) => r.role as string);
  const token = signToken(user.id, user.email, roles);

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles,
      mustChangePassword: user.mustChangePassword,
    },
  });
});

// POST /api/auth/register  — admin only after first user
router.post("/register", authenticate, async (req, res) => {
  // Only admins can create new users once the first admin exists
  const adminCount = await prisma.userRole.count({ where: { role: "admin" } });
  if (adminCount > 0 && !req.user?.roles.includes("admin")) {
    res.status(403).json({ error: "Only admins can register new users" });
    return;
  }

  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password, fullName, jobTitleId, supervisorId, roles } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: "Email already in use" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName,
      jobTitleId,
      supervisorId,
      mustChangePassword: true,
      roles: {
        create: roles.map((role) => ({ role: role as "admin" | "employee" | "hr" })),
      },
    },
    include: { roles: true },
  });

  res.status(201).json({
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles: user.roles.map((r) => r.role),
  });
});

// POST /api/auth/seed-admin  — only works when no users exist
router.post("/seed-admin", async (_req, res) => {
  const count = await prisma.user.count();
  if (count > 0) {
    res.status(403).json({ error: "Admin already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash("Admin@1234", 12);
  const user = await prisma.user.create({
    data: {
      email: "admin@company.com",
      passwordHash,
      fullName: "System Admin",
      mustChangePassword: true,
      roles: { create: [{ role: "admin" }] },
    },
    include: { roles: true },
  });

  res.status(201).json({
    message: "Admin created. Change the password immediately.",
    email: user.email,
    temporaryPassword: "Admin@1234",
  });
});

// POST /api/auth/change-password
router.post("/change-password", authenticate, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { currentPassword, newPassword } = parsed.data;
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });

  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  res.json({ message: "Password updated successfully" });
});

// GET /api/auth/me
router.get("/me", authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: {
      roles: true,
      jobTitle: true,
      supervisor: { select: { id: true, fullName: true } },
      _count: { select: { subordinates: true } },
    },
  });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles: user.roles.map((r) => r.role),
    mustChangePassword: user.mustChangePassword,
    jobTitle: user.jobTitle,
    supervisor: user.supervisor,
    subordinateCount: user._count.subordinates,
  });
});

export default router;
