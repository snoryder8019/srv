# Onboarding Forms

Build client intake forms and questionnaires at `/admin/onboarding`.

An onboarding form is a set of questions you can hand to a client — as a public link, a QR code, or a form that appears on their client record.

## The Form List
Every form shows its status and how many responses it has collected.

| Status | Behaviour |
|--------|-----------|
| Draft | Only you can see it — safe to build in |
| Active | Live and reachable at its public link |
| Archived | Retired, hidden from the list |

From the list you can open the builder, preview the form, view responses, duplicate a form as a starting point, or archive one.

## Building a Form
Give the form a name and a short description, then add fields. Each field has a label, a key, and a type.

| Field type | Use it for |
|-----------|-----------|
| Text | Short answers |
| Text Area | Long answers |
| Dropdown | One choice from a list |
| Radio | One choice, all options visible |
| Checkbox | Yes/no, or multiple choices |
| Number | Quantities and figures |
| Email | Email addresses |
| URL | Website links |
| Date | Dates |
| Color | A colour picker |
| Section Heading | A label to break the form into sections |

Fields can be full-width or half-width, and can be marked required.

## Conditional Fields
Any field can be set to show only when an earlier answer matches a condition — equals, does not equal, or contains. Use it to skip questions that don't apply, so the form stays short for each respondent.

## Piping Answers Forward
A field can pull its starting value from another active form's matching field. If a client already answered a question on an earlier form, it arrives pre-filled instead of being asked again.

## AI Field Suggestions
Describe what you want to ask — for example "questions about their social media goals" — and the assistant proposes a form name, description, and a set of fields. Suggestions are a starting point; edit them before saving.

---

## Sharing a Form
Set the form to **Active**, then share it.

- **Public link** — each form has its own address under `/forms/`, branded with your logo, colours, and fonts. Anyone with the link can fill it in.
- **QR code** — generate a code pointing at the form from the QR Codes tool. Good for print, packaging, and in-person intake.
- **On the client record** — tick **Client Onboarding Tab** under "Assign to Pages" and the form appears on the Onboarding tab of every client, so you can fill it in with them or send them through it.

Use **Preview** to walk the form yourself before you send it out.

## Responses
Open **Responses** on any form to see submissions newest-first, with the respondent's name and email and — where the response came from a client record — the client it belongs to. The most recent 200 responses are shown.

## The Simple Intake Form
Separately from the form builder, your site has a built-in intake page at `/onboard` that collects contact details plus business type, goals, budget, timeline, social platforms, current website, and brand notes. Submissions create a client record as a prospect, or update the existing record if the email is already on file.
