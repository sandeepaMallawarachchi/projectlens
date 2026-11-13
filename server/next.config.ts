import type { NextConfig } from 'next';

const root = process.cwd();

const nextConfig: NextConfig = {
  // The parent folder is the VS Code extension; keep tracing and bundling scoped to server/.
  outputFileTracingRoot: root,
  turbopack: { root },
  // Loaded at runtime with require(); they must not be bundled.
  serverExternalPackages: ['typescript', 'eslint', 'typescript-eslint', 'groq-sdk', 'openai', '@google/genai', '@anthropic-ai/sdk', 'nodemailer'],
  outputFileTracingIncludes: {
    '/api/**/*': ['./node_modules/typescript/lib/typescript.js', './node_modules/eslint/**/*', './node_modules/typescript-eslint/**/*', './node_modules/@typescript-eslint/**/*']
  },
  poweredByHeader: false
};

export default nextConfig;
