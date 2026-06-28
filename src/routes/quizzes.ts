import { Router } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

const quizSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  competencyId: z.string().uuid().optional(),
});

const questionSchema = z.object({
  prompt: z.string().min(1),
  orderIndex: z.number().int().min(0).optional(),
  questionType: z.enum(["multipleChoice", "checkbox", "select"]).default("multipleChoice"),
  choices: z
    .array(
      z.object({
        text: z.string().min(1),
        isCorrect: z.boolean(),
        orderIndex: z.number().int().min(0).optional(),
      }),
    )
    .min(2),
});

// GET /api/quizzes
router.get("/", async (req, res) => {
  const roles = req.user!.roles as string[];
  const isAdminOrHr = roles.some((r) => ["admin", "hr"].includes(r));

  const quizzes = await prisma.quiz.findMany({
    where: isAdminOrHr ? undefined : { supervisorId: req.user!.userId },
    include: {
      supervisor: { select: { id: true, fullName: true } },
      _count: { select: { questions: true, assignments: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(quizzes);
});

// GET /api/quizzes/:id
router.get("/:id", async (req, res) => {
  const quiz = await prisma.quiz.findUnique({
    where: { id: req.params.id },
    include: {
      supervisor: { select: { id: true, fullName: true } },
      questions: {
        include: { choices: { orderBy: { orderIndex: "asc" } } },
        orderBy: { orderIndex: "asc" },
      },
    },
  });

  if (!quiz) {
    res.status(404).json({ error: "Quiz not found" });
    return;
  }
  res.json(quiz);
});

// POST /api/quizzes
router.post("/", async (req, res) => {
  const parsed = quizSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const quiz = await prisma.quiz.create({
    data: { ...parsed.data, supervisorId: req.user!.userId },
  });
  res.status(201).json(quiz);
});

// PUT /api/quizzes/:id
router.put("/:id", async (req, res) => {
  const quiz = await prisma.quiz.findUnique({ where: { id: req.params.id } });
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found" });
    return;
  }

  const roles = req.user!.roles as string[];
  if (!roles.includes("admin") && quiz.supervisorId !== req.user!.userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const parsed = quizSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const updated = await prisma.quiz.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(updated);
});

// DELETE /api/quizzes/:id
router.delete("/:id", async (req, res) => {
  const quiz = await prisma.quiz.findUnique({ where: { id: req.params.id } });
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found" });
    return;
  }

  const roles = req.user!.roles as string[];
  if (!roles.includes("admin") && quiz.supervisorId !== req.user!.userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  await prisma.quiz.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// POST /api/quizzes/:id/questions
router.post("/:id/questions", async (req, res) => {
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { choices, ...questionData } = parsed.data;
  const question = await prisma.quizQuestion.create({
    data: {
      ...questionData,
      quizId: req.params.id,
      choices: { create: choices },
    },
    include: { choices: { orderBy: { orderIndex: "asc" } } },
  });
  res.status(201).json(question);
});

// PUT /api/quizzes/:quizId/questions/:questionId
router.put("/:quizId/questions/:questionId", async (req, res) => {
  const parsed = questionSchema.partial().omit({ choices: true }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const question = await prisma.quizQuestion.update({
    where: { id: req.params.questionId },
    data: parsed.data,
    include: { choices: { orderBy: { orderIndex: "asc" } } },
  });
  res.json(question);
});

// DELETE /api/quizzes/:quizId/questions/:questionId
router.delete("/:quizId/questions/:questionId", async (req, res) => {
  await prisma.quizQuestion.delete({ where: { id: req.params.questionId } });
  res.status(204).send();
});

export default router;
