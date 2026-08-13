# Assets

Upload and organize your images and video at `/admin/assets`.

The library is a three-pane screen: folders on the left, your files in the middle, and details for the selected file on the right. On a phone, each pane opens as a drawer.

## Uploading

Drag files onto the drop zone or use the upload button.

- **Images and video only** — other file types are rejected
- Up to **20 files** at a time, **200 MB** each
- Every image also gets a thumbnail and a compact web-ready copy generated automatically, so your public pages load fast while the original stays available for editing and download

If you hit your storage limit the upload is refused with a message telling you so. Storage is set by your plan, and extra space can be added in blocks.

## Folders

Seven folders are built in: All Assets, General, Sections, Portfolio, Blog, Pages, and Clients. You can create, rename, and delete your own alongside them.

A file can live in several folders at once.

**Deleting a custom folder deletes any file whose only folder was that one**, including from storage. Files that also sit in another folder simply lose the tag. Move anything you want to keep before deleting a folder.

## Finding Things

Search by title, filename, or tag. Sort by newest, oldest, name, or largest. Filter to images or video, or by channel or campaign.

## File Details

Select a file to set its title, alt text, caption, tags, folders, the client it belongs to, and its channels and campaigns. From here you can also copy its address, download it, or delete it.

**AI descriptions** — the ✨ button next to Alt Text looks at the image itself and writes accessibility-ready alt text, a caption, and tags. Select several files and use **AI Describe + Alt** to do a batch. Images only.

## Bulk Actions

Turn on **Select** mode to act on several files at once: move them to a folder, attach them to a client, add channels or campaigns, download, describe with AI, or delete.

## Sharing

**Share Link** mints a public address for a file and copies it to your clipboard. Click **Revoke** to switch the link off.

Revoking disables the share link, but the file itself remains publicly readable at its underlying storage address. Treat sharing as convenience, not security — do not use it for anything confidential.

## Importing From Google

Two import paths sit in the Assets toolbar, both needing a one-time connection to your Google account:

- **Google Drive** — browse or search your Drive, pick files, and import up to 50 at a time into a folder you choose
- **Google Photos** — opens Google's own picker in a new tab; the items you pick there import back into Slab, up to 50 per session

Imported files go through the same pipeline as an upload, so they behave identically everywhere.

## Asset Packs

`/admin/assets/packs` imports free, openly licensed icon sets — Heroicons, Lucide, and Tabler — directly into your own library. Search the set, select what you want, and import up to 100 icons at a time.

## Asset Generator

`/admin/assets/social` is a full design canvas for social and marketing imagery. It supports layers (images, text, shapes), cropping, background removal, brand recoloring, gradients, grouping, and undo/redo.

- **Generate Background** creates an image from a text description, flavored with your brand context. **✨ Suggest** drafts the description for you
- **Brand kit** loads your colors, fonts, and logo into the editor
- Save a design as a reusable preset, download it as a PNG, or save it into your library
- **Carousel** splits one wide design into a multi-image post
- **9-Grid** slices a single large design into nine Instagram tiles and schedules them so your profile grid reassembles into one picture. Requires a connected Instagram account, and is capped at four murals per day

## Account Resources

Reached from the **Account Resources** button in the Assets toolbar.

This is where you assign the standing brand imagery each social platform needs — profile pictures, avatars, banners, cover art, channel art — from files already in your library, rather than re-uploading them platform by platform.

Each platform gets a card showing whether it's connected, every image slot it defines, and **the exact pixel size that slot expects**. Click **Assign** on a slot and pick an image from your library.

What happens next depends on the platform:

- **Mastodon, Bluesky, Discord, and Telegram** can be updated directly. Leave **Push live on assign** ticked and the image is applied to the account for you; the slot then shows when it last pushed, or an error if it failed. **Push live** re-applies an existing assignment
- **Every other platform** stores the assignment as a record with the right size, so you can set it in that platform's own app. For these, Account Resources is a sizing guide and a record of what you chose — not automation

**Clear** removes an assignment on your side only. It does not revert anything already applied on the platform.

## Storage

Files are stored in Linode Object Storage. Each account's files are isolated — no other account can reach them.

## Known Limits

- Campaigns can be created and applied here, but not renamed or deleted
- The video trimmer is disabled in this release
