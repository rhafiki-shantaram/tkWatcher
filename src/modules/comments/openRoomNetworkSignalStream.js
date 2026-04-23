/**
 * Open a passive CDP network stream for a live-room page.
 * Phase 1 only: observe and retain raw events, no classification or stop logic.
 * Observability only; room worker owns stop decisions.
 * @param {{ data?: object, deps: object }} ctx
 * @returns {Promise<{ client: any, close: Function, snapshot: Function }>}
 */
export async function openRoomNetworkSignalStream(ctx) {
  const { data = {}, deps } = ctx;
  const {
    page,
    roomHandle = "",
    roomUrl = "",
    remoteDebuggingPort = 0
  } = data;
  const { logger } = deps;

  if (!page) {
    throw new Error("Missing page for room network signal stream.");
  }
  if (!page.target || typeof page.target !== "function") {
    throw new Error("Missing page.target() for room network signal stream.");
  }

  const target = page.target();
  if (!target || typeof target.createCDPSession !== "function") {
    throw new Error("Missing CDP target session support for room network signal stream.");
  }

  const client = await target.createCDPSession();
  await client.send("Network.enable");

  const state = {
    roomHandle,
    roomUrl,
    remoteDebuggingPort,
    counts: {
      requestWillBeSent: 0,
      responseReceived: 0,
      webSocketFrameReceived: 0
    },
    events: [],
    closed: false
  };

  const appendEvent = (event) => {
    if (state.closed) {
      return;
    }
    state.events.push(event);
    if (state.events.length > 100) {
      state.events.shift();
    }
  };

  const onRequestWillBeSent = (params) => {
    state.counts.requestWillBeSent += 1;
    appendEvent(normalizeRequestEvent(params));
  };

  const onResponseReceived = (params) => {
    state.counts.responseReceived += 1;
    appendEvent(normalizeResponseEvent(params));
  };

  const onWebSocketFrameReceived = (params) => {
    state.counts.webSocketFrameReceived += 1;
    appendEvent(normalizeWebSocketFrameEvent(params));
  };

  client.on("Network.requestWillBeSent", onRequestWillBeSent);
  client.on("Network.responseReceived", onResponseReceived);
  client.on("Network.webSocketFrameReceived", onWebSocketFrameReceived);

  logger.info(
    `roomNetwork:open handle=${roomHandle || "(unknown)"} url=${roomUrl || "(unknown)"} cdpPort=${remoteDebuggingPort || 0}`
  );

  return {
    client,
    snapshot() {
      return {
        ...state,
        events: state.events.slice()
      };
    },
    async close() {
      if (state.closed) {
        return false;
      }
      state.closed = true;
      client.off("Network.requestWillBeSent", onRequestWillBeSent);
      client.off("Network.responseReceived", onResponseReceived);
      client.off("Network.webSocketFrameReceived", onWebSocketFrameReceived);
      try {
        await client.detach();
      } catch {
        // Best effort.
      }
      logger.info(
        `roomNetwork:closed handle=${roomHandle || "(unknown)"} url=${roomUrl || "(unknown)"} counts=requestWillBeSent:${state.counts.requestWillBeSent},responseReceived:${state.counts.responseReceived},webSocketFrameReceived:${state.counts.webSocketFrameReceived}`
      );
      return true;
    }
  };
}

function normalizeRequestEvent(params) {
  const request = params?.request || {};
  return {
    event: "requestWillBeSent",
    requestId: String(params?.requestId || ""),
    url: String(request.url || ""),
    method: String(request.method || ""),
    type: String(params?.type || ""),
    timestamp: Number(params?.timestamp || 0)
  };
}

function normalizeResponseEvent(params) {
  const response = params?.response || {};
  return {
    event: "responseReceived",
    requestId: String(params?.requestId || ""),
    url: String(response.url || ""),
    status: Number(response.status || 0),
    mimeType: String(response.mimeType || ""),
    type: String(params?.type || ""),
    timestamp: Number(params?.timestamp || 0)
  };
}

function normalizeWebSocketFrameEvent(params) {
  const response = params?.response || {};
  return {
    event: "webSocketFrameReceived",
    requestId: String(params?.requestId || ""),
    opcode: Number(response.opcode || 0),
    mask: Boolean(response.mask),
    payloadLength: String(response.payloadData || "").length,
    payloadSample: String(response.payloadData || "").slice(0, 120),
    timestamp: Number(params?.timestamp || 0)
  };
}
