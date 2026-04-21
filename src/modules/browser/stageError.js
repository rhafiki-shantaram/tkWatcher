export function createStageError(stage, message, code = "E_WATCH_STAGE") {
  const error = new Error(`${stage}: ${message}`);
  error.stage = stage;
  error.code = code;
  error.exitCode = 1;
  return error;
}
