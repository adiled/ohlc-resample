module.exports = {
  globals: {
  },
  collectCoverage: true,
  coveragePathIgnorePatterns: ['/node_modules|dist/'],
  collectCoverageFrom: ['src/**/*.ts'],
  transform: {
    '.(ts|tsx)': ['ts-jest',
      {
        diagnostics: {
          ignoreCodes: [2345]
        }
      }
    ]
  },
  testRegex: '(/__tests__/.*|\\.(test|spec))\\.(ts|tsx|js)$',
  moduleFileExtensions: ['ts', 'tsx', 'js'],
};