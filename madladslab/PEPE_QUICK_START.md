# 🐸 Pepe Silvio - Live Chat Quick Start

**Status:** ✅ Deployed & Ready (2026-02-21 21:27 UTC)

---

## What You Get

A **floating chat button** (bottom-right) on madladslab.com that opens a live AI chat powered by Anthropic Claude.

**Pepe's job:**
- Answer questions about your AI assistant & smart home services
- Collect names/contacts for consultations
- Never quote prices (says "custom-quoted")
- Professional, warm, no techy jargon

---

## What Happens When Someone Chats

1. **First message** → Email sent to scott@madladslab.com with their message
2. **Chat continues** → Pepe responds instantly via AI
3. **Session stored** → MongoDB saves full transcript (session ID, IP, all messages)
4. **Rate limited** → 20 msgs per visitor, 60/hour per IP

---

## Files Created

```
/srv/madladslab/routes/livechat.js              (backend API)
/srv/madladslab/views/mainContent/chatWidget.ejs (frontend widget)
/srv/madladslab/LIVECHAT_DEPLOYMENT.md          (full technical docs)
```

**Modified:**
```
/srv/madladslab/views/mainContent/mainContent.ejs (added widget include)
/srv/madladslab/routes/index.js                   (registered /livechat route)
```

---

## Testing

1. Visit https://madladslab.com
2. Look for chat button bottom-right
3. Click → chat panel opens
4. Send message → Pepe responds in ~2-3 seconds
5. Check scott@madladslab.com for notification email

---

## Database

**Collection:** `livechats`  
**View sessions:**
```bash
mongosh "mongodb+srv://snoryder8019:51DUBsqu%40red51@cluster0.tpmae.mongodb.net/madLadsLab"
> db.livechats.find().sort({createdAt: -1}).limit(10)
```

---

## Config Required

✅ All set! Using existing:
- `ANTHROPIC_API_KEY` from .env
- `ZOHO_USER` / `ZOHO_PASS` for email
- `DB_URL` for MongoDB

---

## If Issues

1. **Chat not showing:** Clear browser cache, check browser console
2. **No email:** Check spam folder, verify Zoho credentials
3. **AI not responding:** Check ANTHROPIC_API_KEY in .env
4. **Need to restart:** App uses nodemon (auto-restarts on file changes)

---

## Advanced: View Real-Time Logs

If nodemon is running in a terminal:
```bash
ps aux | grep nodemon
# Look for the terminal session, check output
```

Or check Apache logs:
```bash
tail -f /var/log/apache2/error.log
```

---

## What Was NOT Changed

✅ No Apache config modified  
✅ No service restarts needed  
✅ No existing routes/views touched (except adding includes)  
✅ All styling matches existing dark luxury theme  

---

**Ready to go live! Just visit the site and test.** 🚀

---

*Questions? Check LIVECHAT_DEPLOYMENT.md for full technical details.*
