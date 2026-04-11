import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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

  const fileName = req.headers["x-file-name"] || "video.mp4";
  const fileType = req.headers["content-type"] || "video/mp4";

  const ext = fileName.split(".").pop();
  const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    // Read the raw body as a buffer
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: fileType,
    }));

    const publicUrl = `${R2_PUBLIC_BASE}/${key}`;
    return res.status(200).json({ publicUrl, key });

  } catch (err) {
    console.error("R2 upload error:", err);
    return res.status(500).json({ error: err.message });
  }
}
