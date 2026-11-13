'use client';

import { useEffect, useRef, useState } from 'react';

const LINKS: [string, string][] = [
  ['how-it-works', 'How it works'],
  ['extension', 'Extension'],
  ['install', 'Install'],
  ['get-started', 'Get started'],
  ['build-with-ai', 'Build with AI'],
  ['authentication', 'Authentication'],
  ['endpoints', 'Endpoints'],
  ['webhooks', 'Webhooks']
];

/**
 * Header navigation: inline links on desktop, a hamburger with a menu panel on mobile.
 * The link for the section currently under the header is highlighted.
 */
export function NavLinks() {
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Active = the section crossing a line just below the sticky header (works for sections of any height).
  useEffect(() => {
    const sections = LINKS.map(([id]) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = (document.querySelector('.header')?.getBoundingClientRect().height ?? 64) + 24;
      const current = sections.find((s) => {
        const r = s.getBoundingClientRect();
        return r.top <= line && r.bottom > line;
      });
      setActive(window.scrollY < 120 ? null : (current?.id ?? null));
      // Header is transparent at the top of the page and solid once scrolled.
      document.querySelector('.header')?.classList.toggle('scrolled', window.scrollY > 8);
    };
    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // Close the mobile menu on Escape, outside clicks, or when the viewport becomes wide.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const wide = window.matchMedia('(min-width: 1041px)');
    const onWide = () => wide.matches && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  const links = (
    <>
      {LINKS.map(([id, label]) => (
        <a key={id} href={`#${id}`} className={active === id ? 'active' : undefined} aria-current={active === id ? 'true' : undefined} onClick={() => setOpen(false)}>
          {label}
        </a>
      ))}
      <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
        OpenAPI
      </a>
    </>
  );

  return (
    <div className="nav-root" ref={rootRef}>
      <nav className="nav" aria-label="Documentation sections">
        {links}
      </nav>
      <button type="button" className={`menu-btn ${open ? 'open' : ''}`} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((o) => !o)}>
        <span />
        <span />
        <span />
      </button>
      <nav id="mobile-menu" className={`menu-panel ${open ? 'open' : ''}`} aria-label="Documentation sections" aria-hidden={!open}>
        {links}
      </nav>
    </div>
  );
}
