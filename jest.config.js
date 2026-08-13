/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/?(*.)+(test).ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'es2020',
          module: 'commonjs',
          strict: false,
          esModuleInterop: true,
          skipLibCheck: true,
          allowJs: true,
          preserveValueImports: false,
          isolatedModules: true,
          types: ['jest'],
          lib: ['es2020'],
        },
      },
    ],
  },
};