import { Router } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();
router.use(authenticate);

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  jobTitleId: z.string().uuid(),
});

// GET /api/competencies?jobTitleId=...
router.get("/", async (req, res) => {
  const { jobTitleId } = req.query;
  const competencies = await prisma.competency.findMany({
    where: jobTitleId ? { jobTitleId: String(jobTitleId) } : undefined,
    include: { jobTitle: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  res.json(competencies);
});

// GET /api/competencies/:id
router.get("/:id", async (req, res) => {
  const competency = await prisma.competency.findUnique({
    where: { id: req.params.id },
    include: { jobTitle: true },
  });
  if (!competency) {
    res.status(404).json({ error: "Competency not found" });
    return;
  }
  res.json(competency);
});

// POST /api/competencies — HR or Supervisor
router.post("/", async (req, res) => {
  const isHR = req.user?.roles.includes("hr");
  const isSupervisor = (await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { _count: { select: { subordinates: true } } },
  }))?.["_count"]?.subordinates || 0 > 0;

  if (!isHR && !isSupervisor) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const competency = await prisma.competency.create({
    data: parsed.data,
    include: { jobTitle: { select: { id: true, name: true } } },
  });
  res.status(201).json(competency);
});

// PUT /api/competencies/:id — HR or Supervisor
router.put("/:id", async (req, res) => {
  const isHR = req.user?.roles.includes("hr");
  const isSupervisor = (await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { _count: { select: { subordinates: true } } },
  }))?.["_count"]?.subordinates || 0 > 0;

  if (!isHR && !isSupervisor) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const competency = await prisma.competency.update({
    where: { id: req.params.id },
    data: parsed.data,
    include: { jobTitle: { select: { id: true, name: true } } },
  });
  res.json(competency);
});

// DELETE /api/competencies/:id — HR or Supervisor
router.delete("/:id", async (req, res) => {
  const isHR = req.user?.roles.includes("hr");
  const isSupervisor = (await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { _count: { select: { subordinates: true } } },
  }))?.["_count"]?.subordinates || 0 > 0;

  if (!isHR && !isSupervisor) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  await prisma.competency.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
