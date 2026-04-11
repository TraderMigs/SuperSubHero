import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET = "supersubhero-videos";
const R2_PUBLIC_BASE = "https://pub-23dc0cc0dda3466d85d541f4b669c30d.r2.dev";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const action = req.headers["x-action"];
  const uploadId = req.headers["x-upload-id"];
  const key = req.headers["x-key"];
  const partNumber = parseInt(req.headers["x-part-number"] || "1");
  const fileName = req.headers["x-file-name"] || "video.mp4";
  const fileType = req.headers["x-file-type"] || "video/mp4";

  try {
    // ACTION: start — create multipart upload
    if (action === "start") {
      const ext = fileName.split(".").pop();
      const newKey = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const cmd = new CreateMultipartUploadCommand({
        Bucket: R2_BUCKET,
        Key: newKey,
        ContentType: fileType,
      });
      const result = await s3.send(cmd);
      return res.status(200).json({ uploadId: result.UploadId, key: newKey });
    }

    // ACTION: part — upload a chunk
    if (action === "part") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      const cmd = new UploadPartCommand({
        Bucket: R2_BUCKET,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: buffer,
      });
      const result = await s3.send(cmd);
      return res.status(200).json({ ETag: result.ETag, PartNumber: partNumber });
    }

    // ACTION: complete — finalize upload
    if (action === "complete") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const { parts } = JSON.parse(Buffer.concat(chunks).toString());

      const cmd = new CompleteMultipartUploadCommand({
        Bucket: R2_BUCKET,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      });
      await s3.send(cmd);
      const publicUrl = `${R2_PUBLIC_BASE}/${key}`;
      return res.status(200).json({ publicUrl, key });
    }

    // ACTION: abort — cancel failed upload
    if (action === "abort") {
      await s3.send(new AbortMultipartUploadCommand({
        Bucket: R2_BUCKET,
        Key: key,
        UploadId: uploadId,
      }));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action" });

  } catch (err) {
    console.error("Upload chunk error:", err);
    return res.status(500).json({ error: err.message });
  }
}
