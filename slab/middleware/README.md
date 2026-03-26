# Middleware README

Middleware components for the `app.js` stack.

## Purpose
These middleware files handle various aspects of request processing, including tenant resolution, authentication, and file uploads.

## Key Files
- `tenant.js`: Tenant resolution based on the `Host` header.
- `jwtAuth.js`: Admin and portal authentication.
- `superadmin.js`: Superadmin authentication.
- `upload.js`: S3 file uploads.

## Quick Reference

### `tenant.js`
- **Functionality**: Tenant resolution and setting `req.tenant`, `req.db`, `res.locals.brand`.
- **Cache**: 5-minute cache for tenant lookup.
- **Platform Routes**: Tenant-optional for certain routes.
- **Cache Busting**: Use `bustTenantCache(domain)` after tenant doc updates.

### `jwtAuth.js`
- **Admin Auth**: `requireAdmin(req, res, next)` - Verifies `slab_token` cookie.
- **Portal Auth**: `requirePortal(req, res, next)` - Verifies `slab_portal` cookie.
- **Token Issuance**: `issueAdminJWT(user, res)` - 8-hour admin cookie.
- `issuePortalJWT(user, res)` - 24-hour portal cookie.
- **One-Time Token**: `createLoginToken(user)` - 5-minute one-time token for signup redirects.
- **Domain**: All cookies use `.madladslab.com` domain in production.

### `superadmin.js`
- **Superadmin Auth**: `requireSuperAdmin(req, res, next)` - Verifies `slab_super` cookie.
- **Token Issuance**: `issueSuperAdminJWT(user, res)` - 12-hour superadmin cookie.
- **Superadmin Email Check**: `isSuperAdminEmail(email)` - Checks against hardcoded email list.
- **Override**: Superadmin supersedes tenant admin flags in auth callback.

### `upload.js`
- **Functionality**: S3 file uploads with tenant-prefixed paths.
- **Handlers**: `portfolioUpload`, `clientFileUpload`, `sectionUpload`, `meetingAssetUpload`, `brandUpload`.
- **Path Pattern**: `{s3Prefix}/{category}/{timestamp}-{filename}`.