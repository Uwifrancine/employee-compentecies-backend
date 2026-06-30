import { NotificationType } from "@prisma/client";
import prisma from "./prisma";

interface NotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
}

/**
 * Create a notification for a single recipient. Never throws — notification
 * delivery is best-effort and must not break the originating request.
 */
export async function notifyUser(userId: string, data: NotificationInput): Promise<void> {
  try {
    await prisma.notification.create({ data: { ...data, userId } });
  } catch (err) {
    console.error("Failed to create notification:", err);
  }
}

/**
 * Create the same notification for many recipients in one query. Duplicate /
 * empty recipient lists are handled gracefully.
 */
export async function notifyUsers(userIds: string[], data: NotificationInput): Promise<void> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: unique.map((userId) => ({ ...data, userId })),
    });
  } catch (err) {
    console.error("Failed to create notifications:", err);
  }
}
