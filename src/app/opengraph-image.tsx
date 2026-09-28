import { ImageResponse } from "next/og";

export const alt = "CollaboratMD: medical billing and revenue cycle management";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The picture shown when a link to the site is shared: the mark, the name and what it does. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(135deg, #052e16 0%, #14532d 55%, #15803d 100%)", color: "white" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ width: 96, height: 96, display: "flex", position: "relative", borderRadius: 24, background: "linear-gradient(135deg, #22c55e, #15803d)" }}>
            <div style={{ position: "absolute", left: 39.6, top: 16.8, width: 16.8, height: 62.4, borderRadius: 8.4, background: "rgba(255,255,255,0.95)" }} />
            <div style={{ position: "absolute", left: 16.8, top: 39.6, width: 62.4, height: 16.8, borderRadius: 8.4, background: "rgba(255,255,255,0.68)" }} />
          </div>
          <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: -1 }}>CollaboratMD</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>Get paid faster, with fewer denials.</div>
          <div style={{ fontSize: 32, color: "#bbf7d0" }}>Medical billing and revenue cycle management for US practices and billing companies.</div>
        </div>
      </div>
    ),
    size,
  );
}
