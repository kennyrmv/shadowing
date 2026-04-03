// ─── Cloudflare R2 storage client ─────────────────────────────────────────────
//
// S3-compatible API for storing extracted video clips and prosody profiles.
// Uses presigned URLs so the browser can play clips directly from R2
// without proxying through Railway.

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!
const R2_BUCKET = process.env.R2_BUCKET_NAME ?? 'shadowing-clips'

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
})

/** Upload a file buffer to R2 */
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }))
}

/** Generate a presigned GET URL (default 7 days) */
export async function getPresignedUrl(key: string, expiresIn = 7 * 24 * 3600): Promise<string> {
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  }), { expiresIn })
}

/** Delete a file from R2 */
export async function deleteFromR2(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  }))
}

/** Standard key paths for extracted content */
export const r2Keys = {
  clip: (videoId: string, phraseId: string) => `clips/${videoId}/${phraseId}.mp4`,
  audio: (videoId: string, phraseId: string) => `audio/${videoId}/${phraseId}.wav`,
  prosody: (videoId: string, phraseId: string) => `prosody/${videoId}/${phraseId}.json`,
}
