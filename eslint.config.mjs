import nextPlugin from 'eslint-config-next'

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'db/migrations/**',
      'terminals/**',
    ],
  },
  ...nextPlugin,
  {
    rules: {
      // Anticipates React Compiler semantics, but the compiler isn't enabled in
      // next.config.js yet. Many pages use the standard "reset state at the top of a
      // data-fetching effect" pattern, which is functionally correct today. Downgraded
      // to a warning so lint stays actionable without forcing a risky mass refactor;
      // revisit if/when the React Compiler is turned on.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]

export default eslintConfig
