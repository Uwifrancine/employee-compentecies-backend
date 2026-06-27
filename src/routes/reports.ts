import { Router } from "express";
import prisma from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();
router.use(authenticate);

// GET /api/reports/individual/:employeeId
router.get("/individual/:employeeId", async (req, res) => {
  const { employeeId } = req.params;
  const roles = req.user!.roles as string[];
  const isAdminOrHr = roles.some((r) => ["admin", "hr"].includes(r));
  const isSelf = req.user!.userId === employeeId;
  const isSupervisor = await prisma.user
    .findFirst({ where: { id: employeeId, supervisorId: req.user!.userId } })
    .then(Boolean);

  if (!isAdminOrHr && !isSelf && !isSupervisor) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const [employee, evaluations, devPlans, quizAttempts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        fullName: true,
        email: true,
        jobTitle: { select: { id: true, name: true } },
        supervisor: { select: { id: true, fullName: true } },
      },
    }),
    prisma.evaluation.findMany({
      where: { employeeId },
      include: {
        scores: { include: { competency: { select: { id: true, name: true } } } },
        jobTitle: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.developmentPlan.findMany({
      where: { employeeId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.quizAttempt.findMany({
      where: { employeeId },
      include: { assignment: { include: { quiz: { select: { title: true } } } } },
      orderBy: { submittedAt: "desc" },
    }),
  ]);

  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  const avgScore =
    evaluations.length > 0
      ? evaluations.reduce((s, e) => s + e.overallPercent, 0) / evaluations.length
      : null;

  const avgQuizScore =
    quizAttempts.length > 0
      ? quizAttempts.reduce((s, a) => s + a.scorePct, 0) / quizAttempts.length
      : null;

  res.json({
    employee,
    summary: {
      totalEvaluations: evaluations.length,
      averageScore: avgScore ? Math.round(avgScore * 10) / 10 : null,
      totalDevPlans: devPlans.length,
      openDevPlans: devPlans.filter((p) => p.status !== "completed").length,
      totalQuizAttempts: quizAttempts.length,
      averageQuizScore: avgQuizScore ? Math.round(avgQuizScore * 10) / 10 : null,
    },
    evaluations,
    developmentPlans: devPlans,
    quizAttempts,
  });
});

// GET /api/reports/team/:supervisorId  — supervisor's team overview
router.get("/team/:supervisorId", async (req, res) => {
  const { supervisorId } = req.params;
  const roles = req.user!.roles as string[];
  const isAdminOrHr = roles.some((r) => ["admin", "hr"].includes(r));
  const isSelf = req.user!.userId === supervisorId;

  if (!isAdminOrHr && !isSelf) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const subordinates = await prisma.user.findMany({
    where: { supervisorId },
    select: { id: true, fullName: true, jobTitle: { select: { name: true } } },
  });

  const memberStats = await Promise.all(
    subordinates.map(async (emp) => {
      const [latestEval, openPlans, quizAvg] = await Promise.all([
        prisma.evaluation.findFirst({
          where: { employeeId: emp.id },
          orderBy: { createdAt: "desc" },
          select: { overallPercent: true, createdAt: true },
        }),
        prisma.developmentPlan.count({
          where: { employeeId: emp.id, status: { not: "completed" } },
        }),
        prisma.quizAttempt
          .aggregate({ where: { employeeId: emp.id }, _avg: { scorePct: true } })
          .then((r) => r._avg.scorePct),
      ]);

      return {
        ...emp,
        latestEvalScore: latestEval?.overallPercent ?? null,
        latestEvalDate: latestEval?.createdAt ?? null,
        openDevPlans: openPlans,
        avgQuizScore: quizAvg ? Math.round(quizAvg * 10) / 10 : null,
      };
    })
  );

  res.json({ supervisorId, teamSize: subordinates.length, members: memberStats });
});

// GET /api/reports/org  — admin/HR only
router.get("/org", requireRole("admin", "hr"), async (_req, res) => {
  const [totalEmployees, totalEvaluations, avgScore, devPlanCounts, quizStats] =
    await Promise.all([
      prisma.user.count(),
      prisma.evaluation.count(),
      prisma.evaluation.aggregate({ _avg: { overallPercent: true } }).then((r) => r._avg.overallPercent),
      prisma.developmentPlan.groupBy({ by: ["status"], _count: true }),
      prisma.quizAttempt.aggregate({ _avg: { scorePct: true }, _count: true }),
    ]);

  const topCompetencies = await prisma.evaluationScore.groupBy({
    by: ["competencyId"],
    _avg: { score: true },
    orderBy: { _avg: { score: "desc" } },
    take: 5,
  });

  const topCompetencyDetails = await prisma.competency.findMany({
    where: { id: { in: topCompetencies.map((c) => c.competencyId) } },
    select: { id: true, name: true },
  });

  const competencyMap = new Map(topCompetencyDetails.map((c) => [c.id, c.name]));

  res.json({
    totalEmployees,
    totalEvaluations,
    averageScore: avgScore ? Math.round(avgScore * 10) / 10 : null,
    developmentPlansByStatus: Object.fromEntries(
      devPlanCounts.map((d) => [d.status, d._count])
    ),
    quizAttempts: quizStats._count,
    averageQuizScore: quizStats._avg.scorePct
      ? Math.round(quizStats._avg.scorePct * 10) / 10
      : null,
    topCompetencies: topCompetencies.map((c) => ({
      competencyId: c.competencyId,
      name: competencyMap.get(c.competencyId) ?? "Unknown",
      avgScore: c._avg.score ? Math.round(c._avg.score * 10) / 10 : null,
    })),
  });
});

export default router;
