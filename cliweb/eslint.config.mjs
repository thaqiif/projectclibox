import nextConfig from 'eslint-config-next';

export default [
  ...nextConfig,
  {
    ignores: [
      '.next/**',
      'out/**',
      'node_modules/**',
      'public/serwist/**',
      '*.config.js',
      '*.config.mjs',
    ],
  },
];
