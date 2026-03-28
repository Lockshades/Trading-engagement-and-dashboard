module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['./src/test/setup.js'],
  moduleFileExtensions: ['js', 'jsx'],
  testMatch: ['**/src/**/*.test.jsx']
}