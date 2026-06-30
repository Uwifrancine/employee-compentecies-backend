import { Router } from "express";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

// GET /api/notifications — current user's notifications (latest first) + unread count
router.get("/", async (req, res) => {
  const userId = req.user!.userId;
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  res.json({ items, unreadCount });
});

// POST /api/notifications/read-all — mark all of the user's notifications read
router.post("/read-all", async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.userId, isRead: false },
    data: { isRead: true },
  });
  res.status(204).send();
});

// POST /api/notifications/:id/read — mark a single notification read (must own it)
router.post("/:id/read", async (req, res) => {
  const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!notification || notification.userId !== req.user!.userId) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
  res.status(204).send();
});

export default router;
