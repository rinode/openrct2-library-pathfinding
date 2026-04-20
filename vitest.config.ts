import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        globals: false,
        include: ["test/**/*.test.ts"],
        pool: "threads",
        maxWorkers: 2,
        minWorkers: 1,
        fileParallelism: false,
    },
});
