import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'contracts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { 'no-undef': 'off' } }, // TS handles globals; avoids false positives on fetch/process
  // tests poke at deep Micheline unions structurally — `any` is fine there (not shipped)
  { files: ['src/tests/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
