import { createStageError } from "../browser/stageError.js";

export function createCommentCaptureStageError(stage, message, code) {
  return createStageError(stage, message, code);
}
