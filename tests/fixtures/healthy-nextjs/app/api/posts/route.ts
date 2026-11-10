import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { authOptions } from '@/lib/auth';

const createPost = z.object({ title: z.string().min(1).max(200), body: z.string().min(1) });

export async function GET() {
  try {
    const posts = await prisma.post.findMany({ select: { id: true, title: true, body: true }, take: 50 });
    return NextResponse.json({ posts });
  } catch {
    return NextResponse.json({ error: 'Failed to load posts' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const parsed = createPost.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const author = await prisma.user.findUniqueOrThrow({ where: { email: session.user.email } });
    const post = await prisma.post.create({ data: { ...parsed.data, authorId: author.id } });
    return NextResponse.json({ post }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 });
  }
}
