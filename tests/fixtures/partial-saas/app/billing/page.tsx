'use client';

import { useEffect, useState } from 'react';

export default function BillingPage() {
  const [invoices, setInvoices] = useState<{ id: string }[]>([]);
  useEffect(() => {
    fetch('/api/billing/invoices')
      .then((r) => r.json())
      .then(setInvoices)
      .catch(() => setInvoices([]));
  }, []);
  async function upgrade() {
    await fetch('/api/billing/checkout', { method: 'POST' });
  }
  return (
    <div>
      <button onClick={upgrade}>Upgrade</button>
      <ul>{invoices.map((i) => <li key={i.id}>{i.id}</li>)}</ul>
    </div>
  );
}
