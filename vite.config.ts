import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths, so the built game works from a sub-path such as
  // https://<user>.github.io/tacticsgame/ (GitHub Pages) as well as from the root.
  base: "./",
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
