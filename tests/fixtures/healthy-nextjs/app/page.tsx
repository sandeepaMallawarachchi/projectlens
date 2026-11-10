import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Posts</h1>
      <Link href="/posts">Browse posts</Link>
    </main>
  );
}
