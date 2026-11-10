import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  const event = await req.json();
  if (event.type === 'customer.subscription.updated') {
    await prisma.subscription.update({ where: { id: event.data.object.id }, data: { status: event.data.object.status } });
  }
  return new Response('ok');
}
