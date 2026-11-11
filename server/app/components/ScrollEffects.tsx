'use client';

import { useEffect } from 'react';

/**
 * Fades `.reveal` elements in as they enter the viewport. Content stays visible without
 * JavaScript and for users who prefer reduced motion (the `motion` class is only added here).
 */
export function ScrollEffects() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      return;
    }
    const root = document.documentElement;
    root.classList.add('motion');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            observer.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return null;
}
