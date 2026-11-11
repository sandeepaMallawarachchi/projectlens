'use client';

import { useState } from 'react';

/** Code sample with a copy button. */
export function CodeBlock({ title, code, tall }: { title: string; code: string; tall?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={tall ? 'code code-tall' : 'code'}>
      <div className="code-head">
        <span>{title}</span>
        <button
          className="copy"
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          aria-label={`Copy ${title}`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
