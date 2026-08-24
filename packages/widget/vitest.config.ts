import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: false,
    include: ['test/**/*.test.ts'],
    environmentOptions: {
      // The widget injects a Google Fonts <link> into document.head, and
      // happy-dom would happily go and FETCH it. The suite must never touch the
      // network: what is under test is that the <link> is there, exactly once,
      // pointing at the right stylesheet — not that Google is up.
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
        },
      },
    },
  },
});
