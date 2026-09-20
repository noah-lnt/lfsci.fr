import { rpc } from "@/lib/rpc";
import type { QueueEntry } from "./queue-store";

/** The two-step upload of spec §16.1, run from a persisted entry rather than a `File`. */
export async function uploadEntry(entry: QueueEntry): Promise<void> {
  const upload = await rpc.documents.createUpload({
    filename: entry.filename,
    contentType: entry.contentType,
    contentLength: entry.size,
    sha256: entry.sha256,
  });

  // content-length is a forbidden header in the browser; the store derives it.
  const headers = Object.fromEntries(
    Object.entries(upload.headers).filter(([key]) => key.toLowerCase() !== "content-length"),
  );
  const response = await fetch(upload.url, { method: "PUT", headers, body: entry.bytes });
  if (!response.ok) throw new Error(`upload failed with ${response.status}`);

  await rpc.documents.finalizeUpload({
    uploadId: upload.uploadId,
    documentId: upload.documentId,
    sha256: entry.sha256,
    contentLength: entry.size,
    metadata: {
      title: entry.filename,
      nature: entry.target.nature,
      ...(entry.target.object
        ? {
            links: [{ relation: entry.target.relation ?? "attached", object: entry.target.object }],
          }
        : {}),
    },
  });
}
