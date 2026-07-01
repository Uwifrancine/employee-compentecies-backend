import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();
router.use(authenticate);

const updateSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  jobTitleId: z.string().uuid().nullable().optional(),
  supervisorId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  roles: z.array(z.enum(["admin", "employee", "hr"])).optional(),
});

const employeeSelect = {
  id: true,
  email: true,
  fullName: true,
  mustChangePassword: true,
  isActive: true,
  createdAt: true,
  jobTitle: { select: { id: true, name: true } },
  supervisor: { select: { id: true, fullName: true } },
  roles: { select: { role: true } },
  _count: { select: { subordinates: true } },
};

// GET /api/employees
router.get("/", async (req, res) => {
  const isAdminOrHr = req.user?.roles.some((r) => ["admin", "hr"].includes(r));

  if (isAdminOrHr) {
    const employees = await prisma.user.findMany({
      select: employeeSelect,
      orderBy: { fullName: "asc" },
    });
    res.json(employees);
    return;
  }

  // Supervisors see only their direct subordinates
  const employees = await prisma.user.findMany({
    where: { supervisorId: req.user!.userId },
    select: employeeSelect,
    orderBy: { fullName: "asc" },
  });
  res.json(employees);
});

// GET /api/employees/:id
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const isAdminOrHr = req.user?.roles.some((r) => ["admin", "hr"].includes(r));
  const isSelf = req.user?.userId === id;
  const isSupervisor = await prisma.user
    .findFirst({ where: { id, supervisorId: req.user!.userId } })
    .then(Boolean);

  if (!isAdminOrHr && !isSelf && !isSupervisor) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const employee = await prisma.user.findUnique({
    where: { id },
    select: {
      ...employeeSelect,
      subordinates: { select: { id: true, fullName: true } },
    },
  });

  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  res.json(employee);
});

// PUT /api/employees/:id
router.put("/:id", requireRole("admin", "hr"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { roles, jobTitleId, supervisorId, isActive, ...data } = parsed.data;
  const isAdmin = req.user?.roles.includes("admin");
  const isHr = req.user?.roles.includes("hr");

  // Only admins can update isActive, roles; only HR can update jobTitleId, supervisorId
  if (isActive !== undefined && !isAdmin) {
    res.status(403).json({ error: "Only admins can update employee status" });
    return;
  }

  if ((jobTitleId !== undefined || supervisorId !== undefined) && !isHr) {
    res.status(403).json({ error: "Only HR can assign job titles and supervisors" });
    return;
  }

  if (roles && !isAdmin) {
    res.status(403).json({ error: "Only admins can assign roles" });
    return;
  }

  // Check if trying to assign supervisor to admin user
  if (supervisorId !== undefined && supervisorId !== null) {
    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { roles: { select: { role: true } } },
    });
    const targetUserRole = targetUser?.roles[0]?.role ?? "employee";
    if (targetUserRole === "admin" || roles?.includes("admin")) {
      res.status(400).json({ error: "Admin users cannot have supervisors" });
      return;
    }
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { ...data, isActive, jobTitleId, supervisorId },
    select: employeeSelect,
  });

  if (roles) {
    await prisma.userRole.deleteMany({ where: { userId: req.params.id } });
    await prisma.userRole.createMany({
      data: roles.map((role) => ({ userId: req.params.id, role: role as "admin" | "employee" | "hr" })),
    });
  }

  res.json(user);
});

// PUT /api/employees/:id/reset-password
router.put("/:id/reset-password", requireRole("admin"), async (req, res) => {
  const { password } = req.body;

  if (!password || typeof password !== "string") {
    res.status(400).json({ error: "Password is required" });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  const employeeId = req.params.id;

  // Verify employee exists
  const employee = await prisma.user.findUnique({ where: { id: employeeId } });
  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  // Hash password and update
  const hashedPassword = await bcrypt.hash(password, 10);
  const updated = await prisma.user.update({
    where: { id: employeeId },
    data: {
      passwordHash: hashedPassword,
      mustChangePassword: true,
    },
    select: employeeSelect,
  });

  res.json(updated);
});

// DELETE /api/employees/:id
router.delete("/:id", requireRole("admin"), async (req, res) => {
  await prisma.user.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
