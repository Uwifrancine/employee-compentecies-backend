import "dotenv/config";
import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth";
import employeesRoutes from "./routes/employees";
import jobTitlesRoutes from "./routes/job-titles";
import competenciesRoutes from "./routes/competencies";
import evaluationsRoutes from "./routes/evaluations";
import devPlansRoutes from "./routes/development-plans";
import quizzesRoutes from "./routes/quizzes";
import quizAssignmentsRoutes from "./routes/quiz-assignments";
import reportsRoutes from "./routes/reports";

const app = express();
const PORT = process.env.PORT ?? 4000;

const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((s) => s.trim());
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)) }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/employees", employeesRoutes);
app.use("/api/job-titles", jobTitlesRoutes);
app.use("/api/competencies", competenciesRoutes);
app.use("/api/evaluations", evaluationsRoutes);
app.use("/api/development-plans", devPlansRoutes);
app.use("/api/quizzes", quizzesRoutes);
app.use("/api/quiz-assignments", quizAssignmentsRoutes);
app.use("/api/reports", reportsRoutes);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});

export default app;
