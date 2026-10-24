import {defineConfig,globalIgnores} from 'eslint/config';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
export default defineConfig([
  ...tseslint.configs.recommended,
  {files:['src/**/*.{ts,tsx}'],plugins:{'@next/next':nextPlugin,'react-hooks':reactHooks},rules:{...nextPlugin.configs.recommended.rules,...nextPlugin.configs['core-web-vitals'].rules,...reactHooks.configs.recommended.rules}},
  globalIgnores(['.next/**','src/generated/**','data/**','artifacts/**','public/ocr/**']),
]);
