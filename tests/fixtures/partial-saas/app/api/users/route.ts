import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  const body = await req.json();
  const user = await prisma.user.create({ data: body });
  return Response.json(user);
}
