import { Router } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();
router.use(authenticate);

const updateSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  jobTitleId: z.string().uuid().nullable().optional(),
  supervisorId: z.string().uuid().nullable().optional(),
  roles: z.array(z.enum(["admin", "employee", "hr"])).optional(),
});

const employeeSelect = {
  id: true,
  email: true,
  fullName: true,
  mustChangePassword: true,
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

  const { roles, ...data } = parsed.data;

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data,
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

// DELETE /api/employees/:id
router.delete("/:id", requireRole("admin"), async (req, res) => {
  await prisma.user.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
