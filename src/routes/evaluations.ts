import { Router } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  employeeId: z.string().uuid().optional(),
  jobTitleId: z.string().uuid(),
  evaluatorType: z.enum(["self", "supervisor"]),
  notes: z.string().optional(),
  scores: z.array(
    z.object({
      competencyId: z.string().uuid(),
      score: z.number().min(0).max(100),
      comment: z.string().optional(),
    })
  ),
});

function overallPercent(scores: { score: number }[]): number {
  if (!scores.length) return 0;
  return scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
}

function buildWhere(userId: string, roles: string[]) {
  const isAdminOrHr = roles.some((r) => ["admin", "hr"].includes(r));
  if (isAdminOrHr) return {};
  return {
    OR: [
      { employeeId: userId },
      { evaluatorId: userId },
      { employee: { supervisorId: userId } }, // supervisor sees their reports' evals
    ],
  };
}

// GET /api/evaluations
router.get("/", async (req, res) => {
  const where = buildWhere(req.user!.userId, req.user!.roles as string[]);
  const evaluations = await prisma.evaluation.findMany({
    where,
    include: {
      employee: { select: { id: true, fullName: true } },
      evaluator: { select: { id: true, fullName: true } },
      jobTitle: { select: { id: true, name: true } },
      _count: { select: { scores: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(evaluations);
});

// GET /api/evaluations/:id
router.get("/:id", async (req, res) => {
  const evaluation = await prisma.evaluation.findUnique({
    where: { id: req.params.id },
    include: {
      employee: { select: { id: true, fullName: true } },
      evaluator: { select: { id: true, fullName: true } },
      jobTitle: { select: { id: true, name: true } },
      scores: {
        include: { competency: { select: { id: true, name: true, description: true } } },
      },
    },
  });

  if (!evaluation) {
    res.status(404).json({ error: "Evaluation not found" });
    return;
  }

  const roles = req.user!.roles as string[];
  const isAdminOrHr = roles.some((r) => ["admin", "hr"].includes(r));
  const isInvolved =
    evaluation.employeeId === req.user!.userId || evaluation.evaluatorId === req.user!.userId;

  if (!isAdminOrHr && !isInvolved) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  res.json(evaluation);
});

// POST /api/evaluations
router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { scores, employeeId: rawEmployeeId, ...rest } = parsed.data;
  const employeeId = rawEmployeeId ?? req.user!.userId;
  const overall = overallPercent(scores);

  const evaluation = await prisma.evaluation.create({
    data: {
      ...rest,
      employeeId,
      evaluatorId: req.user!.userId,
      overallPercent: overall,
      scores: {
        create: scores.map(({ competencyId, score, comment }) => ({ competencyId, score, comment })),
      },
    },
    include: {
      employee: { select: { id: true, fullName: true } },
      scores: { include: { competency: { select: { id: true, name: true } } } },
    },
  });

  res.status(201).json(evaluation);
});

// DELETE /api/evaluations/:id
router.delete("/:id", async (req, res) => {
  const evaluation = await prisma.evaluation.findUnique({ where: { id: req.params.id } });
  if (!evaluation) {
    res.status(404).json({ error: "Evaluation not found" });
    return;
  }

  const roles = req.user!.roles as string[];
  const isAdmin = roles.includes("admin");
  const isEvaluator = evaluation.evaluatorId === req.user!.userId;

  if (!isAdmin && !isEvaluator) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  await prisma.evaluation.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
