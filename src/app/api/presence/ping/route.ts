import { getApiSession } from "@/lib/access";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const { session, response } = await getApiSession();
  if (response) return response;

  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) {
    return new Response("غير مصرح", { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { lastSeenAt: new Date() },
    select: { id: true },
  });

  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
