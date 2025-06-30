export default {
  // The test environment that will be used for testing
  testEnvironment: 'node',
  // The glob patterns Jest uses to detect test files
  testMatch: ['**/test/**/*.test.js'],
  // An array of regexp pattern strings that are matched against all test paths
  testPathIgnorePatterns: ['/node_modules/'],
  // Indicates whether each individual test should be reported during the run
  verbose: true,
  // Transform files with babel-jest
  transform: {},
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
};
