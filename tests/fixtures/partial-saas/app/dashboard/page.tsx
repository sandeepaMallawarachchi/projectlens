'use client';

import { useEffect, useState } from 'react';

export default function Dashboard() {
  const [stats, setStats] = useState<{ users: number } | null>(null);
  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats(null));
  }, []);
  return <div>Users: {stats?.users ?? '…'}</div>;
}
