import { Router } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { notifyUser } from "../lib/notify";

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  employeeId: z.string().uuid().optional(),
  jobTitleId: z.string().uuid(),
  evaluatorType: z.enum(["self", "supervisor"]),
  notes: z.string().optional(),
  decision: z.enum(["pass", "fail"]).optional(),
  scores: z.array(
    z.object({
      competencyId: z.string().uuid(),
      score: z.number().min(0).max(100),
      comment: z.string().optional(),
    })
  ).default([]),
});

function calcOverall(scores: { score: number }[]): number {
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
      { employee: { supervisorId: userId } },
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
  const isSupervisor = await prisma.user
    .findFirst({ where: { id: evaluation.employeeId, supervisorId: req.user!.userId } })
    .then(Boolean);

  if (!isAdminOrHr && !isInvolved && !isSupervisor) {
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

  const { scores, decision, employeeId: rawEmployeeId, ...rest } = parsed.data;
  const employeeId = rawEmployeeId ?? req.user!.userId;

  // Prevent duplicate self-evaluations for the same employee + job title
  if (rest.evaluatorType === "self") {
    const existing = await prisma.evaluation.findFirst({
      where: { employeeId, jobTitleId: rest.jobTitleId, evaluatorType: "self" },
    });
    if (existing) {
      res.status(409).json({ error: "Self-evaluation already submitted for this role." });
      return;
    }
  }

  // Supervisors can evaluate anytime, no need for self-evaluation first
  // Determine overall: supervisor decision shortcut OR calculated from scores
  const overallPercent =
    decision === "pass" ? 100 :
    decision === "fail" ? 0 :
    calcOverall(scores);

  const evaluation = await prisma.evaluation.create({
    data: {
      ...rest,
      employeeId,
      evaluatorId: req.user!.userId,
      overallPercent,
      scores: scores.length
        ? { create: scores.map(({ competencyId, score, comment }) => ({ competencyId, score, comment })) }
        : undefined,
    },
    include: {
      employee: { select: { id: true, fullName: true, supervisorId: true } },
      scores: { include: { competency: { select: { id: true, name: true } } } },
    },
  });

  // Fire-and-forget notifications (best-effort; must not block the response)
  if (evaluation.evaluatorType === "self") {
    // Employee finished a self-evaluation → supervisor now has a pending review
    if (evaluation.employee.supervisorId) {
      await notifyUser(evaluation.employee.supervisorId, {
        type: "self_evaluation_submitted",
        title: "Self-evaluation submitted",
        message: `${evaluation.employee.fullName} completed their self-evaluation. A supervisor review is now pending.`,
        link: "/supervisor",
      });
    }
  } else if (evaluation.evaluatorType === "supervisor") {
    // Supervisor finished evaluating → notify the employee (unless self-evaluating)
    if (evaluation.employeeId !== evaluation.evaluatorId) {
      const passed = evaluation.overallPercent >= 60;
      await notifyUser(evaluation.employeeId, {
        type: "supervisor_evaluation_completed",
        title: "Your evaluation is ready",
        message: `Your supervisor completed your evaluation — ${Math.round(
          evaluation.overallPercent
        )}% (${passed ? "Approved" : "Needs development"}).`,
        link: "/evaluations",
      });
    }
  }

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
