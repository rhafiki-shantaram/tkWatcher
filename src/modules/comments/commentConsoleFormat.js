/**
 * Format one lean terminal line for a captured room comment.
 * @param {{ roomHandle?: string, roomUrl?: string, commenter?: string, text?: string, source?: string }} comment
 * @returns {string}
 */
export function formatCommentConsoleLine(comment) {
  const roomHandle = String(comment?.roomHandle || "").trim();
  const roomUrl = String(comment?.roomUrl || "").trim();
  const commenter = String(comment?.commenter || "").trim();
  const text = String(comment?.text || "").trim();
  const source = String(comment?.source || "").trim();

  return [
    "commentRoom:comment",
    `handle=${roomHandle || "(unknown)"}`,
    `url=${roomUrl || "(unknown)"}`,
    `commenter=${commenter || "(unknown)"}`,
    `text=${text || "(empty)"}`,
    `source=${source || "(unknown)"}`
  ].join(" ");
}
