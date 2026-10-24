export {
  courseKeys,
  fetchCourses,
  fetchAllCourses,
  fetchCoursesPaged,
  fetchTermsPaged,
  fetchSubjectsPaged,
  fetchCourse,
  createSubjectRequest,
  updateSubjectRequest,
  deleteSubjectRequest,
  createTermRequest,
  updateTermRequest,
  deleteTermRequest,
  createCourseRequest,
  updateCourseRequest,
  deleteCourseRequest,
} from './api/course-api'
export type {
  CourseItem,
  SubjectItem,
  TermItem,
  CourseSubjectRef,
  CourseGroupRef,
  CourseTeacherRef,
  CourseTermRef,
} from './model/types'
export { CourseSelect } from './ui/course-select'
