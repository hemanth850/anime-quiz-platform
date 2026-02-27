import { FormEvent, useEffect, useState } from "react";
import { API_URL } from "./types";

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

export default function App() {
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
        throw new Error(body.message ?? `Request failed (${res.status})`);
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
        throw new Error(body.message ?? `Request failed (${res.status})`);
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
      setAuthMessage(body.message ?? "Failed to load profile");
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
      setAuthMessage(body.message ?? "Refresh failed");
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
      <p>Phase 2: JWT auth + PostgreSQL/Prisma persistence is now wired in API.</p>

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
    </main>
  );
}
