# Clients

Manage client records at `/admin/clients`.

## Client Fields
Name, email, phone, company, website, address, status (prospect/active/inactive/churned), and notes.

## Onboarding
Clients can self-register via the public `/onboard` form. The form collects business type, goals, budget, timeline, and other intake data. Submissions create client records automatically.

## Client Portal
Clients sign in via Google OAuth at `/auth/google/client`. Once linked to a client record (by email or onboarding link), they can access their portal to view invoices and shared assets.

## Email Threads
Track email correspondence per client in the detail view. Threads are stored and searchable.

## Tagging
Clients can be tagged to meetings and other resources for cross-referencing.
