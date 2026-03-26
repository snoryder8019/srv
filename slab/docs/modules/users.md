# Users & Permissions

Manage team access at `/admin/users`.

## Roles
- **Admin** — Full access to all admin panel features
- **Client** — Portal access only (invoices, shared assets)

## Granting Admin Access
Admin status is set per user in the users collection. New users created via Google OAuth start without admin access. An existing admin can promote users from the Users page.

## Authentication
Users sign in via Google OAuth. Session is maintained via an 8-hour JWT cookie. Sign out clears the cookie.
