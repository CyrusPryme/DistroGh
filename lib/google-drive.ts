import { Readable } from 'node:stream'
import { google } from 'googleapis'
import { buildFdaDriveFileName } from '@/lib/fda-certificate'

export const MAX_FDA_BYTES = 10 * 1024 * 1024

const ALLOWED_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export function isGoogleDriveConfigured(): boolean {
  return !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() &&
    process.env.GOOGLE_DRIVE_FDA_FOLDER_ID?.trim()
  )
}

function getDriveClient() {
  if (!isGoogleDriveConfigured()) {
    throw new Error(
      'Google Drive is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_DRIVE_FDA_FOLDER_ID.'
    )
  }

  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  })

  return google.drive({ version: 'v3', auth })
}

export type FdaUploadResult = {
  fileId: string
  viewLink: string
  uploadedAt: string
}

export async function uploadFdaCertificateToDrive(params: {
  buffer: Buffer
  mimeType: string
  vendorId: string
  vendorName: string
  acquiredDate: string
  expiryDate: string
  ext: string
}): Promise<FdaUploadResult> {
  const drive = getDriveClient()
  const folderId = process.env.GOOGLE_DRIVE_FDA_FOLDER_ID!.trim()
  const fileName = buildFdaDriveFileName(params)

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: params.mimeType,
      body: Readable.from(params.buffer),
    },
    fields: 'id, webViewLink',
  })

  const fileId = res.data.id
  const viewLink = res.data.webViewLink
  if (!fileId || !viewLink) {
    throw new Error('Google Drive upload succeeded but file metadata was incomplete')
  }

  return {
    fileId,
    viewLink,
    uploadedAt: new Date().toISOString(),
  }
}

export function mimeTypeForFdaExtension(ext: string): string | null {
  return ALLOWED_MIME[ext.toLowerCase()] ?? null
}
