# Git Push Setup Guide

**Issue:** Cannot push to GitHub from server - credential authentication required

**Current Status:**
- 15 commits ahead of origin/main (including today's v0.8.1 commit)
- Remote: https://github.com/snoryder8019/srv.git
- No SSH keys configured
- No credential helper configured

---

## Solution Options

### Option 1: SSH Key Authentication (RECOMMENDED for servers)

**Step 1: Generate SSH key on server**
```bash
# Generate new SSH key
ssh-keygen -t ed25519 -C "your_email@example.com"

# Press Enter to accept default location (~/.ssh/id_ed25519)
# Enter a passphrase (optional but recommended)

# Display the public key
cat ~/.ssh/id_ed25519.pub
```

**Step 2: Add SSH key to GitHub**
1. Copy the entire public key output
2. Go to GitHub → Settings → SSH and GPG keys
3. Click "New SSH key"
4. Paste the public key
5. Give it a title (e.g., "Stringborn Production Server")
6. Click "Add SSH key"

**Step 3: Change remote to SSH**
```bash
cd /srv/ps
git remote set-url origin git@github.com:snoryder8019/srv.git
```

**Step 4: Test and push**
```bash
# Test SSH connection
ssh -T git@github.com

# Should see: "Hi snoryder8019! You've successfully authenticated..."

# Push commits
git push origin main
```

---

### Option 2: Personal Access Token (PAT)

**Step 1: Create PAT on GitHub**
1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a name: "Stringborn Server"
4. Select scopes: `repo` (full control)
5. Click "Generate token"
6. **COPY THE TOKEN IMMEDIATELY** (you won't see it again!)

**Step 2: Configure git credential helper**
```bash
# Store credentials permanently (careful - stores in plaintext)
git config --global credential.helper store

# Or use cache (stores for 15 minutes)
git config --global credential.helper cache
```

**Step 3: Push with token**
```bash
git push origin main

# When prompted:
# Username: snoryder8019
# Password: <paste your PAT token>
```

The credentials will be saved for future pushes.

---

### Option 3: Quick Push with Token (One-time)

If you just need to push once without permanent setup:

```bash
git push https://YOUR_TOKEN@github.com/snoryder8019/srv.git main
```

Replace `YOUR_TOKEN` with your GitHub Personal Access Token.

---

## Recommended Setup (SSH)

For a production server, SSH is the most secure and convenient:

```bash
# 1. Generate key
ssh-keygen -t ed25519 -C "stringborn-server"

# 2. Copy public key
cat ~/.ssh/id_ed25519.pub

# 3. Add to GitHub (web interface)

# 4. Change remote
cd /srv/ps
git remote set-url origin git@github.com:snoryder8019/srv.git

# 5. Test
ssh -T git@github.com

# 6. Push
git push origin main
```

---

## Current Commits Ready to Push

You have **15 commits** ready to push, including:

**Latest commit (Today):**
- v0.8.1 - 3D Galactic Map Rebuild & Connection System
- 98 files changed
- Major 3D visualization fixes
- Connection system infrastructure
- Label system with color coding

**To view all commits:**
```bash
git log origin/main..HEAD --oneline
```

---

## After Push is Working

1. Verify on GitHub that commits are visible
2. Check that the codebase matches your local version
3. Consider setting up branch protection rules
4. Enable GitHub Actions for CI/CD (optional)

---

## Troubleshooting

**"Permission denied (publickey)"**
- SSH key not added to GitHub
- Or wrong remote URL

**"Authentication failed"**
- Invalid PAT token
- Token expired or deleted
- Wrong username

**"Could not read Username"**
- Need to configure credentials
- Or switch to SSH

---

## Security Notes

- **SSH keys:** Most secure for server access
- **PAT tokens:** Should have minimal scopes needed
- **credential.helper store:** Stores in plaintext at `~/.git-credentials`
- **credential.helper cache:** Temporarily stores in memory (safer)

---

## Quick Status Check

```bash
# Check what's ready to push
git status

# See commits ahead
git log origin/main..HEAD --oneline

# Check remote
git remote -v

# Test connection (SSH only)
ssh -T git@github.com
```

---

**Date:** November 1, 2025
**Status:** Ready to push v0.8.1 + 14 previous commits
**Recommendation:** Set up SSH authentication for long-term ease of use
