import {defineConfig} from 'vitest/config';
import path from 'node:path';
export default defineConfig({resolve:{alias:{'@':path.resolve('src')}},test:{include:['tests/**/*.test.ts'],exclude:['tests/e2e/**'],maxWorkers:2}});
