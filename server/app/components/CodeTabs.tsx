'use client';

import { useState } from 'react';

/** Several code samples in one panel: tabs, a copy button for the active one, capped height. */
export function CodeTabs({ tabs, label }: { tabs: { id: string; title: string; hint?: string; code: string }[]; label: string }) {
  const [active, setActive] = useState(tabs[0].id);
  const [copied, setCopied] = useState(false);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className="code code-tabs">
      <div className="code-head">
        <div className="code-tablist" role="tablist" aria-label={label}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={t.id === active}
              aria-controls={`panel-${t.id}`}
              className={t.id === active ? 'on' : ''}
              onClick={() => {
                setActive(t.id);
                setCopied(false);
              }}
            >
              {t.title}
            </button>
          ))}
        </div>
        <button
          className="copy"
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(tab.code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          aria-label={`Copy ${tab.title} sample`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {tab.hint && <div className="code-hint">{tab.hint}</div>}
      <pre id={`panel-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} tabIndex={0}>
        <code>{tab.code}</code>
      </pre>
    </div>
  );
}
