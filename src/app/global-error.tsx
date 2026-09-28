"use client";

/** The last resort, when even the page frame fails. It has no stylesheet, so it is styled inline. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
        <title>Something went wrong · CollaboratMD</title>
        <main style={{ maxWidth: 440, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.5 }}>Nothing you saved was lost. Try again; if it keeps happening, contact support{error.digest ? ` and quote reference ${error.digest}` : ""}.</p>
          <button type="button" onClick={() => retry()} style={{ marginTop: 12, padding: "10px 18px", borderRadius: 8, border: 0, background: "#15803d", color: "white", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
