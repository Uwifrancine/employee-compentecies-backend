import { Router } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

const assignSchema = z.object({
  quizId: z.string().uuid(),
  employeeId: z.string().uuid(),
});

const submitSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().uuid(),
      choiceIds: z.array(z.string().uuid()), // array for all types; empty = no answer
    })
  ),
});

// GET /api/quiz-assignments
router.get("/", async (req, res) => {
  const roles = req.user!.roles as string[];
  const isAdminOrHr = roles.some((r) => ["admin", "hr"].includes(r));

  const assignments = await prisma.quizAssignment.findMany({
    where: isAdminOrHr
      ? undefined
      : {
          OR: [
            { employeeId: req.user!.userId },
            { assignedBy: req.user!.userId },
          ],
        },
    include: {
      quiz: { select: { id: true, title: true } },
      employee: { select: { id: true, fullName: true } },
      attempts: { select: { scorePct: true, submittedAt: true }, orderBy: { submittedAt: "desc" }, take: 1 },
      _count: { select: { attempts: true } },
    },
    orderBy: { assignedAt: "desc" },
  });
  res.json(assignments);
});

// GET /api/quiz-assignments/:id
router.get("/:id", async (req, res) => {
  const assignment = await prisma.quizAssignment.findUnique({
    where: { id: req.params.id },
    include: {
      quiz: {
        include: {
          questions: {
            include: { choices: { orderBy: { orderIndex: "asc" } } },
            orderBy: { orderIndex: "asc" },
          },
        },
      },
      employee: { select: { id: true, fullName: true } },
      attempts: {
        include: { answers: { include: { choice: true } } },
        orderBy: { submittedAt: "desc" },
      },
    },
  });

  if (!assignment) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }

  const roles = req.user!.roles as string[];
  const isAdminOrHr = roles.some((r) => ["admin", "hr"].includes(r));
  const isSupervisor = assignment.assignedBy === req.user!.userId;
  const isEmployee = assignment.employeeId === req.user!.userId;

  if (!isAdminOrHr && !isSupervisor && !isEmployee) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // Hide correct-answer flag from employee view only
  if (isEmployee && !isAdminOrHr && !isSupervisor) {
    const sanitized = {
      ...assignment,
      quiz: {
        ...assignment.quiz,
        questions: assignment.quiz.questions.map((q) => ({
          ...q,
          choices: q.choices.map(({ isCorrect: _ic, ...c }) => c),
        })),
      },
    };
    res.json(sanitized);
    return;
  }

  res.json(assignment);
});

// POST /api/quiz-assignments
router.post("/", async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const assignment = await prisma.quizAssignment.create({
    data: {
      ...parsed.data,
      assignedBy: req.user!.userId,
    },
    include: {
      quiz: { select: { id: true, title: true } },
      employee: { select: { id: true, fullName: true } },
    },
  });
  res.status(201).json(assignment);
});

// POST /api/quiz-assignments/:id/attempt  — employee submits answers
router.post("/:id/attempt", async (req, res) => {
  const assignment = await prisma.quizAssignment.findUnique({
    where: { id: req.params.id },
    include: {
      quiz: {
        include: {
          questions: {
            include: { choices: true },
          },
        },
      },
    },
  });

  if (!assignment) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }

  if (assignment.employeeId !== req.user!.userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  // Score each question
  let correct = 0;
  const total = assignment.quiz.questions.length;

  for (const answer of parsed.data.answers) {
    const question = assignment.quiz.questions.find((q) => q.id === answer.questionId);
    if (!question) continue;

    const correctIds = new Set(question.choices.filter((c) => c.isCorrect).map((c) => c.id));
    const selectedIds = new Set(answer.choiceIds);

    let isCorrect: boolean;
    if (question.questionType === "checkbox") {
      // All correct choices selected AND no wrong ones
      isCorrect =
        selectedIds.size === correctIds.size &&
        [...correctIds].every((id) => selectedIds.has(id));
    } else {
      // multipleChoice / select: exactly one correct answer
      isCorrect = answer.choiceIds.length === 1 && correctIds.has(answer.choiceIds[0]);
    }
    if (isCorrect) correct++;
  }

  const scorePct = total > 0 ? Math.round((correct / total) * 100) : 0;

  // Build answer rows: one QuizAnswer row per selected choice
  const answerRows = parsed.data.answers.flatMap(({ questionId, choiceIds }) =>
    choiceIds.length > 0
      ? choiceIds.map((choiceId) => ({ questionId, choiceId }))
      : [{ questionId, choiceId: null as string | null }]
  );

  const attempt = await prisma.quizAttempt.create({
    data: {
      assignmentId: assignment.id,
      employeeId: req.user!.userId,
      scorePct,
      answers: { create: answerRows },
    },
    include: { answers: true },
  });

  await prisma.quizAssignment.update({
    where: { id: assignment.id },
    data: { status: "completed" },
  });

  res.status(201).json({ ...attempt, scorePct, correct, total });
});

export default router;
