# Email Marketing

Manage campaigns and contacts at `/admin/email-marketing`.

## Contacts
- Import or manually add email contacts
- Fields: name, email, funnel stage (lead/prospect/customer/churned), source, tags, status
- Unsubscribes are tracked automatically via tracking links

## Campaigns
- Create email campaigns with subject, body (HTML), and target contact list
- Schedule sends or send immediately
- Campaign status: draft, scheduled, sent

## Tracking
Every sent email includes invisible tracking:
- **Opens** — tracked via pixel
- **Clicks** — tracked via redirect links
- **Unsubscribes** — one-click unsubscribe link

View analytics per campaign in the detail view.

## Requirements
Email sending requires Zoho SMTP credentials configured in Settings. See [Settings](../platform/settings.md) for setup.
