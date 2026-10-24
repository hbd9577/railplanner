import { useEffect, useState } from "react";

type Health = { status: string; db: string; db_info?: Record<string, unknown> | null };

// Phase 1 placeholder: proves the frontend -> /api -> FastAPI -> Tiger Data path.
export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>RailPlanner</h1>
      <p>Decision support for new US passenger rail corridors.</p>
      <h2>API health</h2>
      {error && <pre>{error}</pre>}
      {!health && !error && <p>Loading…</p>}
      {health && <pre>{JSON.stringify(health, null, 2)}</pre>}
    </main>
  );
}
