import express from 'express';
const router = express.Router();

// Middleware to check if user is admin
function isAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // You can add your admin check logic here
  // For now, just checking if user exists
  if (req.user.isAdmin !== true) {
    return res.status(403).json({ error: 'Forbidden - Admin access required' });
  }

  next();
}

// Admin dashboard home
router.get('/', isAdmin, function(req, res, next) {
  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    user: req.user
  });
});

// Asset generation page
router.get('/generate', isAdmin, function(req, res, next) {
  res.render('admin/generate', {
    title: 'Generate Assets',
    user: req.user
  });
});

// API endpoint to create assets
router.post('/api/generate', isAdmin, async function(req, res, next) {
  try {
    const { assetType, assetData } = req.body;

    // Here you'll add logic to create different types of assets
    // based on assetType (characters, zones, items, etc.)

    switch(assetType) {
      case 'character':
        // Add character creation logic
        res.json({
          success: true,
          message: 'Character created successfully',
          data: assetData
        });
        break;

      case 'zone':
        // Add zone creation logic
        res.json({
          success: true,
          message: 'Zone created successfully',
          data: assetData
        });
        break;

      case 'item':
        // Add item creation logic
        res.json({
          success: true,
          message: 'Item created successfully',
          data: assetData
        });
        break;

      case 'species':
        // Add species creation logic
        res.json({
          success: true,
          message: 'Species created successfully',
          data: assetData
        });
        break;

      default:
        res.status(400).json({
          success: false,
          error: 'Invalid asset type'
        });
    }
  } catch (error) {
    console.error('Error generating asset:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate asset'
    });
  }
});

export default router;
