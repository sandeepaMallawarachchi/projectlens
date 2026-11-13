/** Official brand marks (Simple Icons / GitHub Octicons paths), used to reference the platforms. */

interface IconProps {
  size?: number;
  /** Use currentColor instead of the brand color. */
  mono?: boolean;
  className?: string;
}

export function VSCodeIcon({ size = 18, mono, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill={mono ? 'currentColor' : '#007ACC'}>
      <path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
    </svg>
  );
}

export function GitHubIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function GitLabIcon({ size = 18, mono, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill={mono ? 'currentColor' : '#FC6D26'}>
      <path d="m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z" />
    </svg>
  );
}

/** Generic "integration" icon (Lucide "plug" outline). */
export function PlugIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );
}

/** Generic "AI" sparkle icon (Lucide "sparkles" outline). */
export function SparklesIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
    </svg>
  );
}

/** API / code icon (Lucide "braces" outline). */
export function BracesIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
      <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
    </svg>
  );
}

/** Status / health icon (Lucide "activity" outline). */
export function ActivityIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
    </svg>
  );
}

// Editor brand marks. Cursor, Windsurf and VSCodium paths are from Simple Icons (CC0);
// Cursor and Windsurf use the text color because their brand color is black.

/** Cursor (Simple Icons). */
export function CursorIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" />
    </svg>
  );
}

/** Windsurf (Simple Icons). */
export function WindsurfIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M23.55 5.067c-1.2038-.002-2.1806.973-2.1806 2.1765v4.8676c0 .972-.8035 1.7594-1.7597 1.7594-.568 0-1.1352-.286-1.4718-.7659l-4.9713-7.1003c-.4125-.5896-1.0837-.941-1.8103-.941-1.1334 0-2.1533.9635-2.1533 2.153v4.8957c0 .972-.7969 1.7594-1.7596 1.7594-.57 0-1.1363-.286-1.4728-.7658L.4076 5.1598C.2822 4.9798 0 5.0688 0 5.2882v4.2452c0 .2147.0656.4228.1884.599l5.4748 7.8183c.3234.462.8006.8052 1.3509.9298 1.3771.313 2.6446-.747 2.6446-2.0977v-4.893c0-.972.7875-1.7593 1.7596-1.7593h.003a1.798 1.798 0 0 1 1.4718.7658l4.9723 7.0994c.4135.5905 1.05.941 1.8093.941 1.1587 0 2.1515-.9645 2.1515-2.153v-4.8948c0-.972.7875-1.7594 1.7596-1.7594h.194a.22.22 0 0 0 .2204-.2202v-4.622a.22.22 0 0 0-.2203-.2203Z" />
    </svg>
  );
}

/** VSCodium (Simple Icons, brand color #2F80ED). */
export function VSCodiumIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="#2F80ED">
      <path d="M11.583.54a1.467 1.467 0 0 0-.441 2.032c2.426 3.758 2.999 6.592 2.75 9.075-1.004 4.756-3.187 5.721-5.094 5.721-1.863 0-1.364-3.065.036-3.962.836-.522 1.906-.861 2.728-.861.814 0 1.474-.658 1.474-1.47 0-.812-.66-1.47-1.474-1.47-.96 0-1.901.202-2.78.545.18-.847.246-1.762.014-2.735-.352-1.477-1.367-2.889-3.128-4.257a1.476 1.476 0 0 0-2.069.256c-.5.64-.384 1.564.259 2.063 1.435 1.114 1.908 1.939 2.07 2.618.162.679.032 1.407-.293 2.408-.416 1.349-.9 2.553-1.11 3.708-.105.568-.114 1.187-.14 1.68-1.034-1.006-1.438-2.336-1.438-4.279 0-.811-.66-1.47-1.474-1.47-.814.001-1.473.659-1.473 1.47 0 2.654.776 5.179 2.855 6.863 1.883 1.793 6.67 1.13 6.67 4.01 0 .812 1.19 1.208 2.004 1.208.834 0 1.885-.558 1.885-1.208 0-3.267 3.443-5.253 9.11-5.244A1.472 1.472 0 0 0 24 15.773 1.472 1.472 0 0 0 22.53 14.3c-.388 0-.765.013-1.138.035.634-1.49.915-3.13.857-4.903a1.473 1.473 0 0 0-1.522-1.42 1.472 1.472 0 0 0-1.425 1.517c.076 2.32-.01 4.393-1.74 5.485-.49.31-1.062.58-1.604.58.42-1.145.738-2.353.869-3.655.083-.83.091-1.818-.003-2.585-.148-1.188-.325-2.535.126-3.55.405-.874 1.313-1.24 2.645-1.24.814 0 1.473-.659 1.473-1.47 0-.811-.659-1.47-1.473-1.47-1.98 0-3.481 1.042-4.332 2.3-.445-.95-.987-1.929-1.642-2.943a1.474 1.474 0 0 0-2.037-.44z" />
    </svg>
  );
}

/** Open VSX Registry mark (from the official openvsx web UI, EPL-2.0). */
export function OpenVSXIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="2 2 101 128" className={className} aria-hidden>
      <path d="M30 44.2L52.6 5H7.3zM4.6 88.5h45.3L27.2 49.4zm51 0l22.6 39.2 22.6-39.2z" fill="#c160ef" />
      <path d="M52.6 5L30 44.2h45.2zM27.2 49.4l22.7 39.1 22.6-39.1zm51 0L55.6 88.5h45.2z" fill="#a60ee5" />
    </svg>
  );
}
