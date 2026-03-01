import { FormEvent, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { API_URL, type Era, type RoomState } from "./types";

type HealthResponse = {
  ok: boolean;
  timestamp: string;
  db?: { userCount: number; questionCount: number };
};

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string; role: "PLAYER" | "ADMIN" };
};

type MeResponse = {
  id: string;
  email: string;
  username: string;
  role: "PLAYER" | "ADMIN";
  createdAt: string;
};

type Tab = "auth" | "multiplayer" | "rankings";

type RoomAck = { ok: boolean; message?: string; roomId?: string; playerId?: string };

function parseApiMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }

  const candidate = body as { message?: unknown };
  if (typeof candidate.message === "string") {
    return candidate.message;
  }

  if (candidate.message && typeof candidate.message === "object") {
    const nested = candidate.message as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
    const formError = nested.formErrors?.[0];
    if (formError) {
      return formError;
    }

    const firstField = Object.entries(nested.fieldErrors ?? {}).find(([, msgs]) => Array.isArray(msgs) && msgs.length > 0);
    if (firstField) {
      const [field, msgs] = firstField;
      return `${field}: ${msgs[0]}`;
    }
  }

  return fallback;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("auth");

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("player@example.com");
  const [username, setUsername] = useState("player1");
  const [password, setPassword] = useState("password123");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authMessage, setAuthMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    fetch(`${API_URL}/health`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Health check failed (${res.status})`);
        }
        return (await res.json()) as HealthResponse;
      })
      .then((data) => {
        if (mounted) {
          setHealth(data);
        }
      })
      .catch((err: unknown) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function handleAuth(path: "register" | "login", e: FormEvent) {
    e.preventDefault();
    setAuthMessage("");
    setMe(null);

    try {
      const res = await fetch(`${API_URL}/api/auth/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(path === "register" ? { email, username, password } : { email, password }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(parseApiMessage(body, `Request failed (${res.status})`));
      }

      const data = (await res.json()) as AuthResponse;
      setAccessToken(data.accessToken);
      setRefreshToken(data.refreshToken);
      setAuthMessage(`${path} success as ${data.user.username} (${data.user.role})`);
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Auth failed");
    }
  }

  async function handleLoginClick() {
    setAuthMessage("");
    setMe(null);

    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(parseApiMessage(body, `Request failed (${res.status})`));
      }

      const data = (await res.json()) as AuthResponse;
      setAccessToken(data.accessToken);
      setRefreshToken(data.refreshToken);
      setAuthMessage(`login success as ${data.user.username} (${data.user.role})`);
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Auth failed");
    }
  }

  async function fetchMe() {
    if (!accessToken) {
      setAuthMessage("Login or register first");
      return;
    }

    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setAuthMessage(parseApiMessage(body, "Failed to load profile"));
      return;
    }

    const data = (await res.json()) as MeResponse;
    setMe(data);
  }

  async function refreshAccess() {
    if (!refreshToken) {
      setAuthMessage("No refresh token available");
      return;
    }

    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setAuthMessage(parseApiMessage(body, "Refresh failed"));
      return;
    }

    const data = (await res.json()) as AuthResponse;
    setAccessToken(data.accessToken);
    setRefreshToken(data.refreshToken);
    setAuthMessage("Access token refreshed");
  }

  return (
    <main className="container">
      <h1>Anime Quiz Platform</h1>
      <p>Live multiplayer anime quiz with auth + rankings.</p>

      <div className="tabs">
        <button className={tab === "auth" ? "active" : ""} onClick={() => setTab("auth")}>Auth</button>
        <button className={tab === "multiplayer" ? "active" : ""} onClick={() => setTab("multiplayer")}>Multiplayer</button>
        <button className={tab === "rankings" ? "active" : ""} onClick={() => setTab("rankings")}>Rankings</button>
      </div>

      <section className="card">
        <h2>Runtime Status</h2>
        <p>
          API URL: <code>{API_URL}</code>
        </p>
        {health ? (
          <div className="ok">
            <p>API healthy at {new Date(health.timestamp).toLocaleString()}</p>
            {health.db ? (
              <p>
                DB users: {health.db.userCount}, questions: {health.db.questionCount}
              </p>
            ) : null}
          </div>
        ) : error ? (
          <p className="err">API check failed: {error}</p>
        ) : (
          <p>Checking API health...</p>
        )}
      </section>

      {tab === "auth" ? (
        <section className="card">
          <h2>Auth Smoke Test</h2>
          <form onSubmit={(e) => void handleAuth("register", e)} className="auth-grid">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
            <button type="submit">Register</button>
            <button type="button" onClick={() => void handleLoginClick()}>
              Login
            </button>
          </form>

          <div className="auth-actions">
            <button onClick={() => void fetchMe()}>Get /auth/me</button>
            <button onClick={() => void refreshAccess()}>Refresh Access Token</button>
          </div>

          {authMessage ? <p>{authMessage}</p> : null}
          {me ? (
            <p>
              Signed in as <strong>{me.username}</strong> ({me.role})
            </p>
          ) : null}
        </section>
      ) : tab === "multiplayer" ? (
        <MultiplayerPanel accessToken={accessToken} defaultName={me?.username ?? username} />
      ) : (
        <RankingsPanel />
      )}
    </main>
  );
}

function RankingsPanel() {
  const [globalRankings, setGlobalRankings] = useState<Array<{ player: string; points: number }>>([]);
  const [rankedBoard, setRankedBoard] = useState<Array<{ rank: number; username: string; rating: number; matches: number }>>([]);
  const [message, setMessage] = useState("Loading rankings...");

  async function loadBoards() {
    try {
      const [globalRes, rankedRes] = await Promise.all([
        fetch(`${API_URL}/api/rankings`),
        fetch(`${API_URL}/api/leaderboards/ranked`),
      ]);

      const globalBody = await globalRes.json().catch(() => ({ items: [] }));
      const rankedBody = await rankedRes.json().catch(() => ({ items: [] }));

      if (!globalRes.ok && !rankedRes.ok) {
        setMessage("Could not load rankings yet.");
        return;
      }

      setGlobalRankings(Array.isArray(globalBody.items) ? globalBody.items : []);
      setRankedBoard(Array.isArray(rankedBody.items) ? rankedBody.items : []);
      setMessage("");
    } catch {
      setMessage("Could not load rankings yet.");
    }
  }

  useEffect(() => {
    void loadBoards();
  }, []);

  return (
    <section className="card">
      <h2>Rankings</h2>
      <div className="auth-actions">
        <button onClick={() => void loadBoards()}>Refresh</button>
      </div>
      {message ? <p>{message}</p> : null}
      <h3>Global Points</h3>
      {globalRankings.length === 0 ? <p>No data yet</p> : null}
      {globalRankings.slice(0, 20).map((row, idx) => (
        <p key={`${row.player}-${idx}`}>{idx + 1}. {row.player} - {row.points} pts</p>
      ))}

      <h3>Ranked MMR</h3>
      {rankedBoard.length === 0 ? <p>No ranked data yet</p> : null}
      {rankedBoard.slice(0, 20).map((row) => (
        <p key={`${row.rank}-${row.username}`}>{row.rank}. {row.username} - {row.rating} MMR ({row.matches} matches)</p>
      ))}
    </section>
  );
}

function MultiplayerPanel({ accessToken, defaultName }: { accessToken: string; defaultName: string }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [name, setName] = useState(defaultName || "Player");
  const [roomCode, setRoomCode] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [message, setMessage] = useState("Disconnected");
  const [answerMessage, setAnswerMessage] = useState("");

  const [settings, setSettings] = useState({
    genre: "",
    studio: "",
    era: "" as "" | Era,
    mode: "casual" as "casual" | "ranked",
    questionCount: 5,
    timePerQuestionSec: 15,
  });

  useEffect(() => {
    setName(defaultName || "Player");
  }, [defaultName]);

  useEffect(() => {
    const s = io(API_URL);
    setSocket(s);

    s.on("connect", () => setMessage("Connected"));
    s.on("room:state", (state: RoomState) => setRoomState(state));
    s.on("room:ended", () => setMessage("Quiz ended"));

    return () => {
      s.disconnect();
    };
  }, []);

  const isHost = useMemo(() => {
    if (!roomState || !playerId) return false;
    return roomState.players[0]?.id === playerId;
  }, [roomState, playerId]);

  function createRoom() {
    if (!socket) return;
    socket.emit(
      "room:create",
      {
        hostName: name,
        accessToken: accessToken || undefined,
        settings: {
          genre: settings.genre || undefined,
          studio: settings.studio || undefined,
          era: settings.era || undefined,
          mode: settings.mode,
          questionCount: settings.questionCount,
          timePerQuestionSec: settings.timePerQuestionSec,
        },
      },
      (res: RoomAck) => {
        if (!res.ok || !res.roomId || !res.playerId) {
          setMessage(res.message ?? "Failed to create room");
          return;
        }
        setRoomCode(res.roomId);
        setPlayerId(res.playerId);
        setMessage(`Room ${res.roomId} created`);
      },
    );
  }

  function joinRoom() {
    if (!socket || !roomCode.trim()) return;
    socket.emit(
      "room:join",
      { roomId: roomCode.trim(), playerName: name, accessToken: accessToken || undefined },
      (res: RoomAck) => {
        if (!res.ok || !res.roomId || !res.playerId) {
          setMessage(res.message ?? "Failed to join room");
          return;
        }
        setRoomCode(res.roomId);
        setPlayerId(res.playerId);
        setMessage(`Joined room ${res.roomId}`);
      },
    );
  }

  function startRoom() {
    if (!socket || !roomCode || !playerId) return;
    socket.emit("room:start", { roomId: roomCode, playerId }, (res: { ok: boolean; message?: string }) => {
      setMessage(res.ok ? "Quiz started" : res.message ?? "Could not start room");
    });
  }

  function answer(answerIndex: number) {
    if (!socket || !roomCode || !playerId) return;
    socket.emit(
      "room:answer",
      { roomId: roomCode, playerId, answerIndex },
      (res: { ok: boolean; correct?: boolean; points?: number; message?: string }) => {
        if (!res.ok) {
          setAnswerMessage(res.message ?? "Answer failed");
          return;
        }
        setAnswerMessage(res.correct ? `Correct (+${res.points ?? 0})` : "Wrong answer");
      },
    );
  }

  return (
    <section className="card">
      <h2>Multiplayer</h2>
      <div className="multi-grid">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
        <input value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="Room code" />
        <select value={settings.mode} onChange={(e) => setSettings((v) => ({ ...v, mode: e.target.value as "casual" | "ranked" }))}>
          <option value="casual">Casual</option>
          <option value="ranked">Ranked</option>
        </select>
        <input value={settings.genre} onChange={(e) => setSettings((v) => ({ ...v, genre: e.target.value }))} placeholder="Genre (optional)" />
        <input value={settings.studio} onChange={(e) => setSettings((v) => ({ ...v, studio: e.target.value }))} placeholder="Studio (optional)" />
        <select value={settings.era} onChange={(e) => setSettings((v) => ({ ...v, era: e.target.value as "" | Era }))}>
          <option value="">Any era</option>
          <option value="90s">90s</option>
          <option value="2000s">2000s</option>
          <option value="2010s">2010s</option>
          <option value="2020s">2020s</option>
        </select>
      </div>

      <div className="auth-actions">
        <button onClick={createRoom}>Create Room</button>
        <button onClick={joinRoom}>Join Room</button>
        <button onClick={startRoom} disabled={!isHost}>Start Quiz</button>
      </div>

      <p>{message}</p>

      {roomState?.question ? (
        <div>
          <p>
            Q {roomState.currentQuestionIndex + 1}/{roomState.totalQuestions} | Time left: {roomState.remainingSeconds}s | Spectators: {roomState.spectators}
          </p>
          <h3>{roomState.question.prompt}</h3>
          <div className="answers-grid">
            {roomState.question.options.map((opt, idx) => (
              <button key={`${idx}-${opt}`} onClick={() => answer(idx)}>
                {opt}
              </button>
            ))}
          </div>
          {answerMessage ? <p>{answerMessage}</p> : null}
        </div>
      ) : null}

      {roomState ? (
        <div>
          <h3>Players</h3>
          {roomState.players.map((p) => (
            <p key={p.id}>
              {p.name}: {p.score} {p.connected ? "" : "(offline)"}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
