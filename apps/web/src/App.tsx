import { useEffect, useState } from "react";
import { API_URL } from "./types";

type HealthResponse = {
  ok: boolean;
  timestamp: string;
};

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="container">
      <h1>Anime Quiz Platform</h1>
      <p>Real-time anime quiz rooms with timed scoring and multiplayer support.</p>

      <section className="card">
        <h2>Runtime Status</h2>
        <p>
          API URL: <code>{API_URL}</code>
        </p>
        {health ? (
          <p className="ok">API healthy at {new Date(health.timestamp).toLocaleString()}</p>
        ) : error ? (
          <p className="err">API check failed: {error}</p>
        ) : (
          <p>Checking API health...</p>
        )}
      </section>

      <section className="card">
        <h2>Next Delivery</h2>
        <ul>
          <li>Lobby and room join/create screens</li>
          <li>Live question/timer answer flow</li>
          <li>Final leaderboard and replay</li>
        </ul>
      </section>
    </main>
  );
}

