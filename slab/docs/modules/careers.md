# Careers

Post jobs and collect applications at `/admin/careers`.

**Careers is experimental.** It does not appear in your sidebar until the workspace owner switches it on at `/admin/labs`.

Postings appear publicly at `/careers`, and each one gets its own page at `/careers/{slug}`.

## Creating a Posting

| Field | Notes |
|-------|-------|
| Title | Required |
| URL Slug | Leave blank to generate one from the title. Must be unique |
| Department | Groups postings and can be used to filter a Data List block |
| City, State / Region, Country, Postal Code | Powers Google Jobs and job-board feeds |
| Employment Type | Full-time, part-time, contract, temporary, or internship |
| Remote OK | Tick this and leave the location blank for a remote-only role |
| Salary Min, Salary Max, Currency | All optional. Currency defaults to USD |
| Closes At | Optional. The posting drops off your site automatically after this date |
| Description | The main body of the posting |
| Requirements | One per line |
| Benefits | One per line |
| How to Apply | See below |

## How People Apply

Choose one of three modes per posting:

- **On-site form** — applications are collected in Slab and land in your inbox
- **External link** — sends applicants to your own applicant tracking system or job board
- **Email** — opens the applicant's mail app addressed to you

The on-site form asks for full name and email (both required), plus optional phone, a LinkedIn or portfolio address, a cover letter, and a résumé.

## Publishing

A posting is either **Draft** (hidden) or **Open** (public). Use **Publish** to make it live and **Close** to pull it back to draft.

Two things also take a posting off your public site without changing its status:

- Its **Closes At** date passing
- Deleting it — though the applications you already received are kept

## Applications

The inbox at `/admin/careers/applications` lists everything received. Filter by posting or by stage.

Each application moves through a pipeline: **new**, **screening**, **interview**, **offer**, **hired**, **rejected**. New submissions start at *new*. Open an application and use the Pipeline card to move it along.

The postings list shows an open-application count per job — everything not yet marked hired or rejected.

**No email is sent when an application arrives, and applicants receive no automatic acknowledgement.** Check the inbox regularly, and reply to candidates yourself.

## Résumés and Privacy

Résumés are handled as private data. They are **not** stored on your public site and have no public web address — the only way to open one is the View/Download link inside your admin, which streams the file behind your login.

- Accepted formats: PDF and Word
- Maximum size: 8 MB
- A résumé is optional; an application without one still submits

If an applicant attaches an unsupported file type, their application still goes through — just without the résumé, and with no warning shown to them. Mention accepted formats in your posting text if it matters.

## Getting Listed on Job Boards

The **Connectors** page collects the addresses that external job boards read:

| Feed | Use for |
|------|---------|
| Google Jobs | Automatic — your postings already carry the structured data Google reads |
| XML feed | Most job boards, including Indeed |
| RSS feed | Zapier, Make, and other automation tools |

Copy the address you need and hand it to the board. Feeds always reflect open postings only, so closing a posting removes it on the board's next check.

This page hands out addresses — it does not confirm that a board has picked them up. There is no per-board connection status.

**LinkedIn auto-announce** is the exception. Switch it on and each newly opened posting is posted to the LinkedIn account you connected under `/admin/social`. Re-opening a posting never posts it twice. You can also share any open posting manually with the **Share** button in the postings list.

## Putting Jobs on Other Pages

Careers is available as a content source in the Pages builder. Add a **Data List** block to any page, choose **Careers / Jobs** as its source, and optionally filter to a single department. See [Pages](pages.md).

## Footer "We're Hiring" Block

Under **Design & Copy** → **Content** tab → **Section Visibility**, switching **Careers** on adds a hiring callout and a careers link to your site footer. This controls the footer only — your `/careers` page stays reachable either way. To take postings off your site, set them back to Draft.

## Limits

- Applications cannot be searched, exported, or updated in bulk
- There is no notes field on an application
- Stage changes are not timestamped or logged
