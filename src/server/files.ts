/**
 * Where files live: claim attachments and prepared exports.
 *
 * By default they stay in Postgres (attachments as base64), which needs no
 * setup and is fine for small volumes. With FILE_STORAGE=blob and a private
 * Vercel Blob store connected to the project, new files go to the store
 * instead; they are never public and are read back only through this
 * application's own routes, after its access checks.
 *
 * Patient documents in Blob are PHI held by Vercel, so turn this on only once
 * the BAA with Vercel covers Blob.
 */
import type { Readable } from "node:stream";

export interface FileStore {
  put(key: string, body: Buffer | ReadableStream<Uint8Array>, contentType: string): Promise<string>;
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  del(keys: string[]): Promise<void>;
}

let override: FileStore | null | undefined;

/** Tests swap in an in-memory store. */
export function setFileStore(store: FileStore | null | undefined) {
  override = store;
}

const blobStore: FileStore = {
  async put(key, body, contentType) {
    const { put } = await import("@vercel/blob");
    const r = await put(key, body, { access: "private", contentType, addRandomSuffix: true, multipart: !Buffer.isBuffer(body) });
    return r.pathname;
  },
  async get(key) {
    const { get } = await import("@vercel/blob");
    const r = await get(key, { access: "private" });
    return r?.stream ?? null;
  },
  async del(keys) {
    if (!keys.length) return;
    const { del } = await import("@vercel/blob");
    await del(keys);
  },
};

/** The external store, or null when files stay in the database. */
export function fileStore(): FileStore | null {
  if (override !== undefined) return override;
  return process.env.FILE_STORAGE?.trim().toLowerCase() === "blob" ? blobStore : null;
}

export async function streamToBuffer(stream: ReadableStream<Uint8Array> | Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

/** A memory-backed store for tests. */
export function memoryStore(): FileStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  let n = 0;
  return {
    files,
    async put(key, body) {
      const k = `${key}-${++n}`;
      files.set(k, Buffer.isBuffer(body) ? body : await streamToBuffer(body));
      return k;
    },
    async get(key) {
      const b = files.get(key);
      return b ? new ReadableStream({ start(c) { c.enqueue(new Uint8Array(b)); c.close(); } }) : null;
    },
    async del(keys) {
      for (const k of keys) files.delete(k);
    },
  };
}
