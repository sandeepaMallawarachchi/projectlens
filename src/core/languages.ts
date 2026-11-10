const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
  css: 'CSS', scss: 'SCSS', sass: 'SCSS', less: 'Less',
  html: 'HTML', htm: 'HTML',
  json: 'JSON', jsonc: 'JSON', yml: 'YAML', yaml: 'YAML', toml: 'TOML',
  md: 'Markdown', mdx: 'MDX',
  py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin',
  cs: 'C#', php: 'PHP', swift: 'Swift', c: 'C', h: 'C', cpp: 'C++', hpp: 'C++',
  sql: 'SQL', prisma: 'Prisma', graphql: 'GraphQL', gql: 'GraphQL',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell',
  dart: 'Dart', scala: 'Scala', ex: 'Elixir', exs: 'Elixir'
};

const SPECIAL_FILES: Record<string, string> = {
  dockerfile: 'Dockerfile',
  makefile: 'Makefile'
};

/** Languages whose files are parsed with the TypeScript compiler. */
export const JS_TS_EXTENSIONS = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']);

/** Languages that count as "source code" for line totals and coverage. */
export const SOURCE_LANGUAGES = new Set([
  'TypeScript', 'JavaScript', 'Vue', 'Svelte', 'Astro', 'Python', 'Ruby', 'Go', 'Rust', 'Java', 'Kotlin',
  'C#', 'PHP', 'Swift', 'C', 'C++', 'Dart', 'Scala', 'Elixir', 'SQL', 'Shell', 'PowerShell'
]);

export function extensionOf(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function detectLanguage(relPath: string): string | undefined {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1).toLowerCase();
  if (SPECIAL_FILES[base]) {
    return SPECIAL_FILES[base];
  }
  if (base.startsWith('dockerfile')) {
    return 'Dockerfile';
  }
  return EXTENSION_LANGUAGES[extensionOf(base)];
}

export function isJsTs(relPath: string): boolean {
  return JS_TS_EXTENSIONS.has(extensionOf(relPath)) && !relPath.endsWith('.d.ts') && !/\.min\.(js|mjs|cjs)$/.test(relPath);
}
