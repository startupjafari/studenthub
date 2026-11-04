// @studenthub/campus-core — геометрия и топология Campus Builder (docs/CAMPUS_BUILDER.md).
// Чистый TypeScript без React, three и Prisma: один и тот же код работает в редакторе, в
// воркере и на сервере при публикации.

export * from './format/schema.js'
export * from './format/ids.js'
export * from './geom/int.js'
export * from './geom/polygon.js'
export * from './topology/edit.js'
export * from './topology/faces.js'
export * from './topology/match-spaces.js'
export * from './validate/floor.js'
export { PlanBuilder, WALL, edgeCaseFixtures } from './fixtures/edge-cases.js'
export {
  generateCampus,
  generateFloor,
  type GenerateFloorOptions,
  type GeneratedCampus,
} from './fixtures/generate.js'
export {
  testCampus,
  type TestCampus,
  type TestCampusBuilding,
  type TestCampusFloor,
} from './fixtures/test-campus.js'
export * from './format/site.js'
export * from './topology/building.js'
export * from './publish/publish.js'
export * from './geom/project.js'
export * from './topology/templates.js'
export * from './nav/index.js'
