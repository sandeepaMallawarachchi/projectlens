'use client';

import { useState } from 'react';

/** Inline command or identifier with a copy button. */
export function CopyChip({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-chip">
      <code>{value}</code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
