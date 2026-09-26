import { ImageResponse } from "next/og";

const SIZES = [180, 192, 512];

/** The app icon as a PNG at the sizes installers ask for, drawn from the same shapes as icon.svg. */
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.includes(size)) return new Response("Not found", { status: 404 });
  const u = size / 32;
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", background: "linear-gradient(135deg, #22c55e, #15803d)", position: "relative" }}>
        <div style={{ position: "absolute", left: 13.2 * u, top: 5.6 * u, width: 5.6 * u, height: 20.8 * u, borderRadius: 2.8 * u, background: "rgba(255,255,255,0.95)" }} />
        <div style={{ position: "absolute", left: 5.6 * u, top: 13.2 * u, width: 20.8 * u, height: 5.6 * u, borderRadius: 2.8 * u, background: "rgba(255,255,255,0.68)" }} />
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
