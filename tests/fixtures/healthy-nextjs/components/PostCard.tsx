export function PostCard({ title, body }: { title: string; body: string }) {
  return (
    <li className="rounded border p-4">
      <h2 className="font-medium">{title}</h2>
      <p>{body}</p>
    </li>
  );
}
