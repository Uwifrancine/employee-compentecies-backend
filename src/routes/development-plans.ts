import { Router } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

const planSchema = z.object({
  employeeId: z.string().uuid(),
  title: z.string().min(1),
  summary: z.string().optional(),
  targetDate: z.string().datetime().optional(),
  evaluationId: z.string().uuid().optional(),
  status: z.enum(["open", "in_progress", "completed"]).optional(),
});

const itemSchema = z.object({
  action: z.string().min(1),
  dueDate: z.string().datetime().optional(),
  status: z.enum(["open", "in_progress", "completed"]).optional(),
});

function buildWhere(userId: string, roles: string[]) {
  const isAdminOrHr = roles.some((r) => ["admin", "hr"].includes(r));
  if (isAdminOrHr) return {};
  return { OR: [{ employeeId: userId }, { supervisorId: userId }] };
}

// GET /api/development-plans
router.get("/", async (req, res) => {
  const where = buildWhere(req.user!.userId, req.user!.roles as string[]);
  const plans = await prisma.developmentPlan.findMany({
    where,
    include: {
      employee: { select: { id: true, fullName: true } },
      supervisor: { select: { id: true, fullName: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(plans);
});

// GET /api/development-plans/:id
router.get("/:id", async (req, res) => {
  const plan = await prisma.developmentPlan.findUnique({
    where: { id: req.params.id },
    include: {
      employee: { select: { id: true, fullName: true } },
      supervisor: { select: { id: true, fullName: true } },
      evaluation: { select: { id: true, createdAt: true, overallPercent: true } },
      items: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!plan) {
    res.status(404).json({ error: "Development plan not found" });
    return;
  }

  const roles = req.user!.roles as string[];
  const isAdminOrHr = roles.some((r) => ["admin", "hr"].includes(r));
  const isInvolved =
    plan.employeeId === req.user!.userId || plan.supervisorId === req.user!.userId;

  if (!isAdminOrHr && !isInvolved) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  res.json(plan);
});

// POST /api/development-plans
router.post("/", async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const plan = await prisma.developmentPlan.create({
    data: {
      ...parsed.data,
      supervisorId: req.user!.userId,
      targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : undefined,
    },
    include: {
      employee: { select: { id: true, fullName: true } },
      items: true,
    },
  });
  res.status(201).json(plan);
});

// PUT /api/development-plans/:id
router.put("/:id", async (req, res) => {
  const plan = await prisma.developmentPlan.findUnique({ where: { id: req.params.id } });
  if (!plan) {
    res.status(404).json({ error: "Development plan not found" });
    return;
  }

  const roles = req.user!.roles as string[];
  const isAdmin = roles.includes("admin");
  const isSupervisor = plan.supervisorId === req.user!.userId;

  if (!isAdmin && !isSupervisor) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const parsed = planSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const updated = await prisma.developmentPlan.update({
    where: { id: req.params.id },
    data: {
      ...parsed.data,
      targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : undefined,
    },
    include: { items: true },
  });
  res.json(updated);
});

// DELETE /api/development-plans/:id
router.delete("/:id", async (req, res) => {
  const plan = await prisma.developmentPlan.findUnique({ where: { id: req.params.id } });
  if (!plan) {
    res.status(404).json({ error: "Development plan not found" });
    return;
  }

  const roles = req.user!.roles as string[];
  if (!roles.includes("admin") && plan.supervisorId !== req.user!.userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  await prisma.developmentPlan.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// POST /api/development-plans/:id/items
router.post("/:id/items", async (req, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const item = await prisma.devPlanItem.create({
    data: {
      ...parsed.data,
      planId: req.params.id,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
    },
  });
  res.status(201).json(item);
});

// PUT /api/development-plans/:planId/items/:itemId
router.put("/:planId/items/:itemId", async (req, res) => {
  const parsed = itemSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const item = await prisma.devPlanItem.update({
    where: { id: req.params.itemId },
    data: {
      ...parsed.data,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
    },
  });
  res.json(item);
});

// DELETE /api/development-plans/:planId/items/:itemId
router.delete("/:planId/items/:itemId", async (req, res) => {
  await prisma.devPlanItem.delete({ where: { id: req.params.itemId } });
  res.status(204).send();
});

export default router;
