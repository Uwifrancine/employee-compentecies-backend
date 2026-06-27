import { Router } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();
router.use(authenticate);

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

// GET /api/job-titles
router.get("/", async (_req, res) => {
  const jobTitles = await prisma.jobTitle.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { competencies: true, users: true } } },
  });
  res.json(jobTitles);
});

// GET /api/job-titles/:id
router.get("/:id", async (req, res) => {
  const jobTitle = await prisma.jobTitle.findUnique({
    where: { id: req.params.id },
    include: { competencies: { orderBy: { name: "asc" } } },
  });
  if (!jobTitle) {
    res.status(404).json({ error: "Job title not found" });
    return;
  }
  res.json(jobTitle);
});

// POST /api/job-titles
router.post("/", requireRole("admin"), async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const jobTitle = await prisma.jobTitle.create({ data: parsed.data });
  res.status(201).json(jobTitle);
});

// PUT /api/job-titles/:id
router.put("/:id", requireRole("admin"), async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const jobTitle = await prisma.jobTitle.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json(jobTitle);
});

// DELETE /api/job-titles/:id
router.delete("/:id", requireRole("admin"), async (req, res) => {
  await prisma.jobTitle.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
