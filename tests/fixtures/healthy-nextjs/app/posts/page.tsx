'use client';

import { useEffect, useState } from 'react';
import { PostCard } from '@/components/PostCard';

interface Post {
  id: string;
  title: string;
  body: string;
}

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/posts')
      .then((res) => res.json())
      .then((data: { posts: Post[] }) => setPosts(data.posts))
      .catch(() => setError('Could not load posts'));
  }, []);

  if (error) {
    return <p role="alert">{error}</p>;
  }
  return (
    <ul>
      {posts.map((p) => (
        <PostCard key={p.id} title={p.title} body={p.body} />
      ))}
    </ul>
  );
}
