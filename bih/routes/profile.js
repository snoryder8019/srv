const router = require('express').Router();
const multer = require('multer');
const User = require('../models/User');
const { uploadAvatar } = require('../lib/storage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images only'));
  }
});

function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/login');
}

// Profile settings page
router.get('/', ensureAuth, (req, res) => {
  res.render('profile', { success: null, error: null });
});

// Update display name
router.post('/update-name', ensureAuth, async (req, res) => {
  try {
    const { displayName } = req.body;
    if (!displayName || !displayName.trim()) {
      return res.render('profile', { error: 'Display name cannot be empty', success: null });
    }
    await User.findByIdAndUpdate(req.user._id, { displayName: displayName.trim() });
    req.user.displayName = displayName.trim();
    res.render('profile', { success: 'Display name updated', error: null });
  } catch (err) {
    console.error(err);
    res.render('profile', { error: 'Failed to update name', success: null });
  }
});

// Update avatar
router.post('/update-avatar', ensureAuth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.render('profile', { error: 'No image selected', success: null });
    }
    const publicUrl = await uploadAvatar(req.file.buffer, req.file.originalname);
    await User.findByIdAndUpdate(req.user._id, { avatar: publicUrl });
    req.user.avatar = publicUrl;
    res.render('profile', { success: 'Avatar updated', error: null });
  } catch (err) {
    console.error(err);
    res.render('profile', { error: 'Failed to upload avatar', success: null });
  }
});

// Update Epic / Twitch IDs
router.post('/update-ids', ensureAuth, async (req, res) => {
  try {
    const { epicId, twitchId } = req.body;
    const update = {
      epicId: epicId ? epicId.trim() : '',
      twitchId: twitchId ? twitchId.trim() : ''
    };
    await User.findByIdAndUpdate(req.user._id, update);
    req.user.epicId = update.epicId;
    req.user.twitchId = update.twitchId;
    res.render('profile', { success: 'Gaming IDs updated', error: null });
  } catch (err) {
    console.error(err);
    res.render('profile', { error: 'Failed to update gaming IDs', success: null });
  }
});

module.exports = router;
