import { defineConfig } from 'astro/config';

// Static output: Vercel serves /dist with zero config, no adapter needed.
export default defineConfig({
  build: { inlineStylesheets: 'always' },
});
