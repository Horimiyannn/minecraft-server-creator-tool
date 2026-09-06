import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@ui$': '<rootDir>/src/ui',
    '^@ui/(.*)$': '<rootDir>/src/ui/$1',
    '^@components$': '<rootDir>/src/components',
    '^@components/(.*)$': '<rootDir>/src/components/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/', '<rootDir>/e2e/'],
};

export default createJestConfig(customJestConfig);
