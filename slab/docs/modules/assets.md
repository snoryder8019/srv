# Assets

Upload and organize files at `/admin/assets`.

## Features
- Upload images, videos, and documents
- Organize into custom folders
- Generate shareable public links (via share tokens)
- Video trimming tool built-in
- Social media preset builder (sized templates for different platforms)

## Storage
Files are stored in Linode Object Storage (S3-compatible). Each tenant's files are isolated by prefix — no cross-tenant access.

## Public URLs
Shared assets are accessible via `/assets/share/{token}`. Revoking the share token removes public access.
