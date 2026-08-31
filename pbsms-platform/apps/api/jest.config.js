/**
 * Unit test config. e2e tests use test/jest-e2e.json instead (see package.json).
 *
 * NFR-QA-010's two halves are enforced two different ways: "100% of permission
 * and tenant-isolation boundary conditions" is the existing EC-400 protected
 * `tenant-isolation.e2e-spec.ts` suite (not this file); "80% line coverage on
 * domain/business-logic modules" is the threshold below, scoped to
 * `*.service.ts` and job handlers specifically — where business logic actually
 * lives in this codebase, as opposed to controllers/DTOs/modules, which are
 * thin wiring and would dilute the number without testing anything real.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  collectCoverageFrom: ['modules/**/*.service.ts', 'jobs-worker/handlers/*.handler.ts'],
  coverageThreshold: {
    global: {
      lines: 80,
    },
  },
};
