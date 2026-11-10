import type { TechnologyCategory } from '../../models/types';

export interface TechnologyDefinition {
  id: string;
  name: string;
  category: TechnologyCategory;
  /** Package names; a trailing `/*` matches a scope prefix. */
  packages?: string[];
  /** Config files (matched against workspace-relative paths). */
  configFiles?: RegExp;
  /** package.json script content that implies usage of the tool's CLI. */
  scripts?: RegExp;
  /** Content signals evaluated on matching files during the scan. */
  content?: { files: RegExp; pattern: RegExp };
  /** Rank used to pick the primary framework (lower = more specific). */
  frameworkRank?: number;
}

export const TECHNOLOGIES: TechnologyDefinition[] = [
  // Full-stack / meta frameworks
  { id: 'nextjs', name: 'Next.js', category: 'fullstack', packages: ['next'], configFiles: /(^|\/)next\.config\.(js|mjs|cjs|ts|mts)$/, scripts: /\bnext (dev|build|start|lint)\b/, frameworkRank: 1 },
  { id: 'nuxt', name: 'Nuxt', category: 'fullstack', packages: ['nuxt'], configFiles: /(^|\/)nuxt\.config\.(js|ts|mjs)$/, scripts: /\bnuxt\b/, frameworkRank: 1 },
  { id: 'remix', name: 'Remix', category: 'fullstack', packages: ['@remix-run/*'], configFiles: /(^|\/)remix\.config\.(js|mjs)$/, frameworkRank: 2 },
  { id: 'sveltekit', name: 'SvelteKit', category: 'fullstack', packages: ['@sveltejs/kit'], configFiles: /(^|\/)svelte\.config\.(js|mjs)$/, frameworkRank: 2 },
  { id: 'astro', name: 'Astro', category: 'fullstack', packages: ['astro'], configFiles: /(^|\/)astro\.config\.(mjs|js|ts)$/, frameworkRank: 2 },
  // Frontend
  { id: 'react', name: 'React', category: 'frontend', packages: ['react', 'react-dom'], frameworkRank: 6 },
  { id: 'vue', name: 'Vue', category: 'frontend', packages: ['vue'], frameworkRank: 5 },
  { id: 'angular', name: 'Angular', category: 'frontend', packages: ['@angular/core'], configFiles: /(^|\/)angular\.json$/, frameworkRank: 4 },
  { id: 'svelte', name: 'Svelte', category: 'frontend', packages: ['svelte'], frameworkRank: 5 },
  { id: 'solid', name: 'SolidJS', category: 'frontend', packages: ['solid-js'], frameworkRank: 5 },
  // Backend
  { id: 'nestjs', name: 'NestJS', category: 'backend', packages: ['@nestjs/core'], configFiles: /(^|\/)nest-cli\.json$/, frameworkRank: 3 },
  { id: 'express', name: 'Express', category: 'backend', packages: ['express'], frameworkRank: 7 },
  { id: 'fastify', name: 'Fastify', category: 'backend', packages: ['fastify'], frameworkRank: 7 },
  { id: 'koa', name: 'Koa', category: 'backend', packages: ['koa'], frameworkRank: 7 },
  { id: 'hono', name: 'Hono', category: 'backend', packages: ['hono'], frameworkRank: 7 },
  { id: 'trpc', name: 'tRPC', category: 'backend', packages: ['@trpc/server'] },
  { id: 'graphql', name: 'GraphQL', category: 'backend', packages: ['graphql', '@apollo/server', 'apollo-server', '@apollo/client'] },
  // Databases & drivers
  { id: 'mongodb', name: 'MongoDB', category: 'database', packages: ['mongodb', 'mongoose'] },
  { id: 'postgresql', name: 'PostgreSQL', category: 'database', packages: ['pg', 'postgres', '@neondatabase/serverless', '@vercel/postgres', 'pg-promise'], content: { files: /(^|\/)(schema\.prisma|docker-compose\.ya?ml|compose\.ya?ml)$|\.env\.example$/, pattern: /provider\s*=\s*"postgresql"|image:\s*postgres|postgres(ql)?:\/\// } },
  { id: 'mysql', name: 'MySQL', category: 'database', packages: ['mysql', 'mysql2', '@planetscale/database'], content: { files: /(^|\/)(schema\.prisma|docker-compose\.ya?ml|compose\.ya?ml)$/, pattern: /provider\s*=\s*"mysql"|image:\s*mysql|image:\s*mariadb/ } },
  { id: 'sqlite', name: 'SQLite', category: 'database', packages: ['better-sqlite3', 'sqlite3', 'sqlite', '@libsql/client'], content: { files: /(^|\/)schema\.prisma$/, pattern: /provider\s*=\s*"sqlite"/ } },
  { id: 'redis', name: 'Redis', category: 'database', packages: ['redis', 'ioredis', '@upstash/redis'], content: { files: /(^|\/)(docker-compose\.ya?ml|compose\.ya?ml)$/, pattern: /image:\s*redis/ } },
  { id: 'supabase', name: 'Supabase', category: 'database', packages: ['@supabase/supabase-js', '@supabase/ssr', '@supabase/auth-helpers-nextjs'], configFiles: /(^|\/)supabase\/config\.toml$/ },
  { id: 'firebase', name: 'Firebase', category: 'cloud', packages: ['firebase', 'firebase-admin', 'firebase-functions'], configFiles: /(^|\/)(firebase\.json|\.firebaserc)$/ },
  // ORMs
  { id: 'mongoose', name: 'Mongoose', category: 'orm', packages: ['mongoose'] },
  { id: 'prisma', name: 'Prisma', category: 'orm', packages: ['@prisma/client', 'prisma'], configFiles: /(^|\/)prisma\/schema\.prisma$|(^|\/)schema\.prisma$/, scripts: /\bprisma\b/ },
  { id: 'drizzle', name: 'Drizzle ORM', category: 'orm', packages: ['drizzle-orm', 'drizzle-kit'], configFiles: /(^|\/)drizzle\.config\.(ts|js|mjs)$/ },
  { id: 'typeorm', name: 'TypeORM', category: 'orm', packages: ['typeorm'] },
  { id: 'sequelize', name: 'Sequelize', category: 'orm', packages: ['sequelize'] },
  { id: 'knex', name: 'Knex', category: 'orm', packages: ['knex'], configFiles: /(^|\/)knexfile\.(js|ts)$/ },
  // Auth
  { id: 'jwt', name: 'JWT (jsonwebtoken / jose)', category: 'auth', packages: ['jsonwebtoken', 'jose', 'jwt-decode', '@nestjs/jwt'] },
  { id: 'nextauth', name: 'NextAuth / Auth.js', category: 'auth', packages: ['next-auth', '@auth/core', '@auth/nextjs', '@auth/prisma-adapter'] },
  { id: 'clerk', name: 'Clerk', category: 'auth', packages: ['@clerk/*'] },
  { id: 'passport', name: 'Passport', category: 'auth', packages: ['passport', 'passport-local', 'passport-jwt'] },
  { id: 'better-auth', name: 'Better Auth', category: 'auth', packages: ['better-auth'] },
  { id: 'lucia', name: 'Lucia', category: 'auth', packages: ['lucia'] },
  { id: 'bcrypt', name: 'bcrypt / argon2 (password hashing)', category: 'auth', packages: ['bcrypt', 'bcryptjs', 'argon2'] },
  { id: 'express-session', name: 'express-session', category: 'auth', packages: ['express-session', 'cookie-session', 'iron-session'] },
  // UI
  { id: 'tailwind', name: 'Tailwind CSS', category: 'ui', packages: ['tailwindcss', '@tailwindcss/postcss', '@tailwindcss/vite'], configFiles: /(^|\/)tailwind\.config\.(js|cjs|mjs|ts)$/, content: { files: /\.(css|scss|pcss)$/, pattern: /@tailwind\s|@import\s+["']tailwindcss/ } },
  { id: 'bootstrap', name: 'Bootstrap', category: 'ui', packages: ['bootstrap', 'react-bootstrap'] },
  { id: 'mui', name: 'Material UI', category: 'ui', packages: ['@mui/material', '@mui/joy'] },
  { id: 'chakra', name: 'Chakra UI', category: 'ui', packages: ['@chakra-ui/react'] },
  { id: 'antd', name: 'Ant Design', category: 'ui', packages: ['antd'] },
  { id: 'shadcn', name: 'shadcn/ui', category: 'ui', configFiles: /(^|\/)components\.json$/, content: { files: /(^|\/)components\.json$/, pattern: /ui\.shadcn\.com/ } },
  { id: 'radix', name: 'Radix UI', category: 'ui', packages: ['@radix-ui/*', 'radix-ui'] },
  { id: 'styled-components', name: 'styled-components', category: 'ui', packages: ['styled-components'] },
  { id: 'emotion', name: 'Emotion', category: 'ui', packages: ['@emotion/react', '@emotion/styled'] },
  { id: 'framer-motion', name: 'Framer Motion', category: 'ui', packages: ['framer-motion', 'motion'] },
  // State & data fetching
  { id: 'redux', name: 'Redux', category: 'state', packages: ['redux', '@reduxjs/toolkit', 'react-redux'] },
  { id: 'zustand', name: 'Zustand', category: 'state', packages: ['zustand'] },
  { id: 'react-query', name: 'TanStack Query', category: 'state', packages: ['@tanstack/react-query', 'react-query'] },
  { id: 'swr', name: 'SWR', category: 'state', packages: ['swr'] },
  { id: 'axios', name: 'Axios', category: 'state', packages: ['axios'] },
  // Validation
  { id: 'zod', name: 'Zod', category: 'validation', packages: ['zod'] },
  { id: 'yup', name: 'Yup', category: 'validation', packages: ['yup'] },
  { id: 'joi', name: 'Joi', category: 'validation', packages: ['joi'] },
  // Testing
  { id: 'jest', name: 'Jest', category: 'testing', packages: ['jest', 'ts-jest'], configFiles: /(^|\/)jest\.config\.(js|ts|mjs|cjs|json)$/, scripts: /\bjest\b/ },
  { id: 'vitest', name: 'Vitest', category: 'testing', packages: ['vitest'], configFiles: /(^|\/)vitest\.config\.(js|ts|mjs|mts)$/, scripts: /\bvitest\b/ },
  { id: 'testing-library', name: 'Testing Library', category: 'testing', packages: ['@testing-library/*'] },
  { id: 'cypress', name: 'Cypress', category: 'testing', packages: ['cypress'], configFiles: /(^|\/)cypress\.config\.(js|ts|mjs)$/ },
  { id: 'playwright', name: 'Playwright', category: 'testing', packages: ['@playwright/test', 'playwright'], configFiles: /(^|\/)playwright\.config\.(js|ts|mjs)$/ },
  { id: 'mocha', name: 'Mocha', category: 'testing', packages: ['mocha'], configFiles: /(^|\/)\.mocharc\.(js|json|ya?ml|cjs)$/, scripts: /\bmocha\b/ },
  { id: 'supertest', name: 'Supertest', category: 'testing', packages: ['supertest'] },
  // Tooling
  { id: 'typescript', name: 'TypeScript', category: 'tooling', packages: ['typescript'], configFiles: /(^|\/)tsconfig(\.[\w-]+)?\.json$/ },
  { id: 'eslint', name: 'ESLint', category: 'tooling', packages: ['eslint'], configFiles: /(^|\/)(eslint\.config\.(js|mjs|cjs|ts)|\.eslintrc(\.(js|cjs|json|ya?ml))?)$/, scripts: /\beslint\b|\bnext lint\b/ },
  { id: 'prettier', name: 'Prettier', category: 'tooling', packages: ['prettier'], configFiles: /(^|\/)(\.prettierrc(\.\w+)?|prettier\.config\.(js|mjs|cjs))$/ },
  { id: 'biome', name: 'Biome', category: 'tooling', packages: ['@biomejs/biome'], configFiles: /(^|\/)biome\.jsonc?$/ },
  { id: 'vite', name: 'Vite', category: 'tooling', packages: ['vite'], configFiles: /(^|\/)vite\.config\.(js|ts|mjs|mts)$/, scripts: /\bvite\b/ },
  { id: 'webpack', name: 'webpack', category: 'tooling', packages: ['webpack'], configFiles: /(^|\/)webpack\.config\.(js|ts|cjs)$/ },
  { id: 'turborepo', name: 'Turborepo', category: 'tooling', packages: ['turbo'], configFiles: /(^|\/)turbo\.json$/ },
  { id: 'husky', name: 'Husky', category: 'tooling', packages: ['husky'], configFiles: /(^|\/)\.husky\// },
  // Infrastructure & deployment
  { id: 'docker', name: 'Docker', category: 'infrastructure', configFiles: /(^|\/)(Dockerfile(\.[\w-]+)?|[\w.-]*\.dockerfile|docker-compose(\.[\w-]+)?\.ya?ml|compose\.ya?ml|\.dockerignore)$/ },
  { id: 'vercel', name: 'Vercel', category: 'infrastructure', packages: ['@vercel/analytics', '@vercel/speed-insights', 'vercel'], configFiles: /(^|\/)vercel\.json$/ },
  { id: 'netlify', name: 'Netlify', category: 'infrastructure', packages: ['@netlify/functions'], configFiles: /(^|\/)netlify\.toml$/ },
  { id: 'github-actions', name: 'GitHub Actions', category: 'infrastructure', configFiles: /(^|\/)\.github\/workflows\/[\w.-]+\.ya?ml$/ },
  { id: 'gitlab-ci', name: 'GitLab CI', category: 'infrastructure', configFiles: /(^|\/)\.gitlab-ci\.ya?ml$/ },
  { id: 'circleci', name: 'CircleCI', category: 'infrastructure', configFiles: /(^|\/)\.circleci\/config\.ya?ml$/ },
  { id: 'kubernetes', name: 'Kubernetes', category: 'infrastructure', content: { files: /\.ya?ml$/, pattern: /^apiVersion:\s*(apps\/v1|v1)\s*$[\s\S]*^kind:\s*(Deployment|Service|Ingress|StatefulSet)/m } },
  { id: 'terraform', name: 'Terraform', category: 'infrastructure', configFiles: /\.tf$/ },
  // Cloud & services
  { id: 'aws-sdk', name: 'AWS SDK', category: 'cloud', packages: ['aws-sdk', '@aws-sdk/*'] },
  { id: 'gcp', name: 'Google Cloud SDK', category: 'cloud', packages: ['@google-cloud/*'] },
  { id: 'azure', name: 'Azure SDK', category: 'cloud', packages: ['@azure/*'] },
  { id: 'stripe', name: 'Stripe', category: 'cloud', packages: ['stripe', '@stripe/stripe-js', '@stripe/react-stripe-js'] },
  { id: 'sentry', name: 'Sentry', category: 'cloud', packages: ['@sentry/*'] },
  { id: 'email', name: 'Email (Nodemailer / Resend)', category: 'cloud', packages: ['nodemailer', 'resend', '@sendgrid/mail'] },
  { id: 'uploadthing', name: 'File uploads (Multer / UploadThing)', category: 'cloud', packages: ['multer', 'uploadthing', '@uploadthing/react'] },
  // AI
  { id: 'openai', name: 'OpenAI SDK', category: 'ai', packages: ['openai'] },
  { id: 'anthropic', name: 'Anthropic SDK', category: 'ai', packages: ['@anthropic-ai/sdk'] },
  { id: 'groq', name: 'Groq SDK', category: 'ai', packages: ['groq-sdk'] },
  { id: 'vercel-ai', name: 'Vercel AI SDK', category: 'ai', packages: ['ai', '@ai-sdk/*'] },
  { id: 'langchain', name: 'LangChain', category: 'ai', packages: ['langchain', '@langchain/*'] }
];

export function packageMatches(pattern: string, name: string): boolean {
  return pattern.endsWith('/*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}
