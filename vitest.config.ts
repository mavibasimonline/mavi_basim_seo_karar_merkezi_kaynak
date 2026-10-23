import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => ({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations'), ADMIN_TOKEN: 'test-only-owner-token', TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } },
  })],
  test: {
    include: ['tests/**/*.test.ts'],
  },
}));
