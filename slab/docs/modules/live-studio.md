# Live Studio

Broadcast live to several platforms at once from `/admin/social/live`.

**Live Studio is experimental and switched off until you turn it on.** Go to **Labs** in the Admin section of the sidebar, find the **Live Studio** card, and flip its toggle. It then appears under **Marketing** in your sidebar marked `exp`. Only the workspace owner or an unrestricted admin can change Labs settings.

Being experimental, it is early and may change. Do a full test run before anything that matters.

## What It Does

Live Studio turns your browser into a broadcast studio. It captures your camera and screen, combines them into one video, and sends that single stream out to every destination you've picked at the same time.

You broadcast **from this browser tab**. Closing it, letting the machine sleep, or losing your connection ends the stream, so keep the tab open and in front of you for the whole broadcast.

## Setting Up a Broadcast

### 1. Choose your sources

- **◉ Enable camera** — your webcam and microphone
- **▣ Share window / screen** — a window, tab, or your whole screen

Then pick a layout: **Screen + camera (PiP)**, **Camera only**, or **Screen only**. If you have more than one camera, a picker appears.

Screen sharing isn't available on mobile browsers, so use a desktop computer.

### 2. Pick your destinations

| Destination | What you need |
|-------------|---------------|
| **▶ YouTube Live** | A connected YouTube account |
| **📘 Facebook Live** | A connected Facebook Page |
| **RTMP destinations** | The stream URL and key from that platform |
| **💬 Discord announce** | A connected Discord webhook |

YouTube and Facebook are handled for you — Slab creates the broadcast and gets the connection details itself, so there are no stream keys to copy. Unconnected accounts show as **not connected**.

**RTMP destinations** cover Twitch, Kick, Rumble, Trovo, or anything else that accepts RTMP. Pick a preset or choose Custom, paste the stream URL and key from that platform, and press **Save**. Saved destinations are remembered for next time, and your keys are encrypted and never shown again.

**Discord announce** isn't a video destination. It posts a "we're live" message with your watch links when you start.

**Instagram Live isn't available** — Instagram has no public API for it.

### 3. Add a title

Fill in the **Title** and optional **Description**. These become the title of your YouTube and Facebook broadcasts.

### 4. Go live

**● Go Live** becomes available once a camera or screen is active. Give it a moment — it can take 10 to 20 seconds to appear on each platform. A red **LIVE** badge shows over the preview, and watch links appear for YouTube and Facebook.

**■ End stream** stops everything and closes out your YouTube and Facebook broadcasts properly.

## The Control Deck

**🎛 Control deck** adds overlays and sound to your broadcast as it happens:

- **Animations** — fire, confetti, and fireworks
- **Sound effects** — airhorn, applause, drumroll, beep, buzzer, and riser
- **Lower third** — a title and subtitle bar you can show and hide
- **Ticker** — a scrolling banner along the bottom
- **Image / logo** — place an image in a corner or the centre

These are baked into the outgoing video, so viewers see them on every platform.

**⧉ Pop out** opens the deck in a second window, and **📱 Remote** shows a QR code you can scan to run the deck from your phone while your computer keeps streaming. Sign in as an admin on the phone, and keep the studio tab open and live.

## Live Chat

A **💬 Live chat** panel pulls comments from YouTube, Facebook, and Twitch into one list as they arrive, each tagged with its platform.

For Twitch chat, fill in the **Twitch channel name** field on your Twitch destination — without it, Twitch chat won't appear.

Chat is **read-only**. You can watch it while you present, but you can't reply, delete, ban, or time anyone out from here. Do that in the platform's own tools.

Alongside it, a **watching now** count shows viewers from YouTube and Facebook. Twitch viewers aren't included. A **latest joiners** list highlights first-time chatters so you can greet them.

## Before Your First Stream

- **YouTube** needs live streaming enabled on the channel, which requires identity verification and can take up to 24 hours to activate the first time. Do this well before you plan to go live.
- **Facebook** needs a connected Page with live video permission granted.
- **Twitch and others** need their stream key, found in that platform's own creator settings.
- Use a desktop browser and a wired connection where you can.

## What Isn't Included

- **No scheduling** — you go live when you press the button, and there's no way to announce a stream ahead of time except the Discord message when you start.
- **No recording or replays** — Slab doesn't save anything. Whatever recording you get is whatever YouTube, Facebook, or Twitch keeps on their side.
- **No viewer page on your own site** — people watch on the platforms themselves. Watch links are shown for YouTube and Facebook only.
- **No stream health readout** — there's no bitrate or dropped-frame indicator, so check how you look on the platform itself once you're live.
