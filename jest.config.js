/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/?(*.)+(test).ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  // 与 vite/tsconfig 的 @/* 别名保持一致，否则测试里 import '@/utils/...' 无法解析
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
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