export {
  assignmentKeys,
  fetchAssignments,
  fetchAssignment,
  fetchSubmissions,
  createAssignmentRequest,
  updateAssignmentRequest,
  publishAssignmentRequest,
  closeAssignmentRequest,
  deleteAssignmentRequest,
  gradeSubmissionRequest,
  returnSubmissionRequest,
  saveSubmissionDraftRequest,
  submitAssignmentRequest,
} from './api/assignment-api'
export type {
  AssignmentItem,
  SubmissionItem,
  AssignmentCourseRef,
  UserRef,
  AssignmentStatus,
  SubmissionStatus,
} from './model/types'
export { studentAssignmentStatus, type StudentAssignmentStatus } from './lib/status'
