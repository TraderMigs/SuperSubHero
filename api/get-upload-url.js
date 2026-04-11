import crypto from "crypto";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = "supersubhero-videos";
const R2_PUBLIC_BASE = "https://pub-23dc0cc0dda3466d85d541f4b669c30d.r2.dev";
const R2_S3_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

function hmac(key, data, encoding) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest(encoding);
}

function hash(data) {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { fileName, fileType } = req.body;
  if (!fileName || !fileType) return res.status(400).json({ error: "fileName and fileType required" });

  const ext = fileName.split(".").pop();
  const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const now = new Date();
  const datestamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzdate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const region = "auto";
  const service = "s3";
  const expires = 3600;

  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`;
  const credential = `${R2_ACCESS_KEY_ID}/${credentialScope}`;

  const canonicalUri = `/${R2_BUCKET}/${key}`;
  const canonicalQuerystring = [
    `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Credential=${encodeURIComponent(credential)}`,
    `X-Amz-Date=${amzdate}`,
    `X-Amz-Expires=${expires}`,
    `X-Amz-SignedHeaders=content-type%3Bhost`,
  ].join("&");

  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const canonicalHeaders = `content-type:${fileType}\nhost:${host}\n`;
  const signedHeaders = "content-type;host";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzdate,
    credentialScope,
    hash(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(
      hmac(
        hmac(`AWS4${R2_SECRET_ACCESS_KEY}`, datestamp),
        region
      ),
      service
    ),
    "aws4_request"
  );

  const signature = hmac(signingKey, stringToSign, "hex");

  const signedUrl =
    `${R2_S3_ENDPOINT}/${R2_BUCKET}/${key}` +
    `?X-Amz-Algorithm=AWS4-HMAC-SHA256` +
    `&X-Amz-Credential=${encodeURIComponent(credential)}` +
    `&X-Amz-Date=${amzdate}` +
    `&X-Amz-Expires=${expires}` +
    `&X-Amz-SignedHeaders=content-type%3Bhost` +
    `&X-Amz-Signature=${signature}`;

  const publicUrl = `${R2_PUBLIC_BASE}/${key}`;

  return res.status(200).json({ signedUrl, publicUrl, key });
}
