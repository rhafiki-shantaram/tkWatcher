function normalizeCommentUserName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const SHOP_ROOM_CODE_BY_HANDLE = {
  "ladygrayy_us": "lg401",
  "lady.grayy.wig": "lg402",
  "lady.grayy.wigs": "lg403"
};

export function resolveShopRoomCode(roomHandle) {
  const normalizedHandle = String(roomHandle || "").trim().toLowerCase();
  return SHOP_ROOM_CODE_BY_HANDLE[normalizedHandle] || "";
}

/**
 * Build one stable comment ingest payload.
 * @param {{ data?: object }} ctx
 * @returns {{ roomHandle: string, shopRoomCode: string, roomUrl: string, commentKey: string, commentKeyWithTimestamp: string, commenter: string, commentUserNameRaw: string, commentUserNameNormalized: string, commentUserNameDisplay: string, text: string, profileName: string, profileHref: string, profileSource: string, source: string, emittedAt: number }}
 */
export function createCommentIngestPayload(ctx) {
  const { data = {} } = ctx || {};
  const {
    roomHandle = "",
    roomUrl = "",
    commentKey = "",
    commenter = "",
    text = "",
    profileName = "",
    profileHref = "",
    profileSource = "",
    source = "dom",
    emittedAt = Date.now()
  } = data;
  const commenterText = String(commenter || "").trim();
  const commenterNormalized = normalizeCommentUserName(commenterText);
  const shopRoomCode = resolveShopRoomCode(roomHandle);
  const emittedAtMs = Math.max(0, Number(emittedAt) || Date.now());
  const commentKeyText = String(commentKey || "").trim();
  const commentKeyWithTimestamp = [shopRoomCode, emittedAtMs, commentKeyText]
    .filter(Boolean)
    .join("|");

  return {
    roomHandle: String(roomHandle || "").trim(),
    shopRoomCode,
    roomUrl: String(roomUrl || "").trim(),
    commentKey: commentKeyText,
    commentKeyWithTimestamp,
    commenter: commenterText,
    commentUserNameRaw: commenterText,
    commentUserNameNormalized: commenterNormalized,
    commentUserNameDisplay: commenterText,
    text: String(text || "").trim(),
    profileName: String(profileName || "").trim(),
    profileHref: String(profileHref || "").trim(),
    profileSource: String(profileSource || "").trim(),
    source: String(source || "dom").trim() || "dom",
    emittedAt: emittedAtMs
  };
}
