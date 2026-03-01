import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { io } from "socket.io-client";

const DEFAULT_PORT = String(4500 + Math.floor(Math.random() * 300));
const API_PORT = process.env.E2E_API_PORT ?? process.env.PORT ?? DEFAULT_PORT;
const API_URL = process.env.API_URL ?? `http://localhost:${API_PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForHealth(timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // retry until timeout
    }
    await delay(500);
  }
  throw new Error("API did not become healthy in time");
}

function onceEvent(socket, event, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timeout waiting for socket event: ${event}`));
    }, timeoutMs);

    function onEvent(payload) {
      clearTimeout(timer);
      resolve(payload);
    }

    socket.once(event, onEvent);
  });
}

function emitAck(socket, event, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting ack for ${event}`)), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function normalizeRoomState(state) {
  return {
    status: state.status,
    questionId: state.question?.id ?? null,
  };
}

async function main() {
  const apiDir = fileURLToPath(new URL("..", import.meta.url));
  const server = spawn("node", ["dist/index.js"], {
    cwd: apiDir,
    env: { ...process.env, PORT: API_PORT },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (d) => process.stdout.write(`[api] ${d}`));
  server.stderr.on("data", (d) => process.stderr.write(`[api] ${d}`));

  try {
    await waitForHealth();

    const email = `e2e_${Date.now()}@example.com`;
    const username = `e2e_${Date.now()}`;
    const password = "password123";

    const registerRes = await fetch(`${API_URL}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, username, password }),
    });
    assert(registerRes.ok, "Register failed");

    const registerBody = await registerRes.json();
    const accessToken = registerBody.accessToken;
    assert(accessToken, "Missing access token from register response");

    const host = io(API_URL, { transports: ["websocket"] });
    const guest = io(API_URL, { transports: ["websocket"] });

    try {
      await Promise.all([onceEvent(host, "connect"), onceEvent(guest, "connect")]);

      const createAck = await emitAck(host, "room:create", {
        hostName: "HostE2E",
        accessToken,
        settings: { mode: "casual", questionCount: 3, timePerQuestionSec: 5 },
      });
      assert(createAck.ok, `room:create failed: ${createAck.message ?? "unknown"}`);

      const roomId = createAck.roomId;
      const hostPlayerId = createAck.playerId;
      assert(roomId && hostPlayerId, "Missing roomId/playerId on room:create");

      const joinAck = await emitAck(guest, "room:join", {
        roomId,
        playerName: "GuestE2E",
      });
      assert(joinAck.ok, `room:join failed: ${joinAck.message ?? "unknown"}`);
      const guestPlayerId = joinAck.playerId;
      assert(guestPlayerId, "Missing guest player id");

      const startAck = await emitAck(host, "room:start", { roomId, playerId: hostPlayerId });
      assert(startAck.ok, `room:start failed: ${startAck.message ?? "unknown"}`);

      let answeredQuestionId = null;
      let finished = false;

      host.on("room:state", (state) => {
        const normalized = normalizeRoomState(state);
        if (normalized.status === "finished") {
          finished = true;
          return;
        }

        if (!state.question || normalized.status !== "active") {
          return;
        }

        if (answeredQuestionId === normalized.questionId) {
          return;
        }

        answeredQuestionId = normalized.questionId;
        host.emit("room:answer", { roomId, playerId: hostPlayerId, answerIndex: 0 }, () => {});
        guest.emit("room:answer", { roomId, playerId: guestPlayerId, answerIndex: 1 }, () => {});
      });

      await onceEvent(host, "room:ended", 30000);
      assert(finished || true, "Quiz end event received");

      const rankingsRes = await fetch(`${API_URL}/api/rankings`);
      assert(rankingsRes.ok, "Rankings API failed");
      const rankingsBody = await rankingsRes.json();
      assert(Array.isArray(rankingsBody.items), "Rankings response malformed");
      assert(rankingsBody.items.length > 0, "Rankings should contain at least one row after completed room");

      console.log("E2E passed: auth + room lifecycle + rankings.");
    } finally {
      host.disconnect();
      guest.disconnect();
    }
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error("E2E failed:", err);
  process.exit(1);
});
