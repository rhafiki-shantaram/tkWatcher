/**
 * Format one lean terminal line for a captured room comment.
 * @param {{ shopRoomCode?: string, commentKeyWithTimestamp?: string, commentKey?: string }} comment
 * @returns {string}
 */
export function formatCommentConsoleLine(comment) {
  const commentKeyWithTimestamp = String(
    comment?.commentKeyWithTimestamp || comment?.commentKey || ""
  ).trim();
  return `commentRoom:comment key=${commentKeyWithTimestamp || `(unknown)`}`;
}
