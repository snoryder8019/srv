import express from "express"
const router = express.Router()
import Sites from "../../api/v1/models/Site.js"
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Admin middleware
async function isAdmin(req, res, next) {
    const user = req.user;
    console.log(`user:${user}`)
    if (user && user.isAdmin === true) {
        return next();
    } else {
        return res.status(401).send('Unauthorized');
    }
}

// Dashboard route
router.get('/', isAdmin, async (req, res) => {
    try {
        const user = req.user;

        // Get all sites
        const siteModel = new Sites();
        const sites = await siteModel.getAll() || [];

        // Get directory info
        const routesPath = path.join(__dirname, '..');
        const dirs = await fs.readdir(routesPath);
        const appDirs = dirs.filter(d => !['index.js', 'securityFunctions', 'users'].includes(d));

        res.render("admin", {
            user: user,
            sites: sites,
            directories: appDirs,
            currentPage: 'dashboard'
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// Sites management route
router.get('/sites', isAdmin, async (req, res) => {
    try {
        const user = req.user;
        const siteModel = new Sites();
        let sites = [];

        try {
            sites = await siteModel.getAll() || [];
        } catch (dbError) {
            console.error('Database error fetching sites:', dbError);
            // Continue with empty array if database fails
        }

        res.render("admin/sites", {
            user: user,
            sites: sites,
            currentPage: 'sites',
            success: req.query.success,
            error: req.query.error
        });
    } catch (error) {
        console.error('Error rendering sites page:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Settings route
router.get('/settings', isAdmin, async (req, res) => {
    try {
        const user = req.user;

        res.render("admin/settings", {
            user: user,
            currentPage: 'settings'
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// Analytics route
router.get('/analytics', isAdmin, async (req, res) => {
    try {
        const user = req.user;

        res.render("admin/analytics", {
            user: user,
            currentPage: 'analytics'
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// Create site endpoint
router.post('/create-site', isAdmin, async (req, res) => {
    try {
        const { siteName, siteUrl } = req.body;

        const siteModel = new Sites();
        await siteModel.create({ siteName, siteUrl, createdAt: new Date() });

        res.redirect('/admin/sites?success=Site created successfully');
    } catch (error) {
        console.error('Error creating site:', error);
        res.redirect('/admin/sites?error=Failed to create site');
    }
});

// Update site endpoint
router.post('/update-site', isAdmin, async (req, res) => {
    try {
        const { siteId, siteName, siteUrl } = req.body;

        if (!siteId) {
            return res.redirect('/admin/sites?error=Site ID is required');
        }

        const siteModel = new Sites();
        const updated = await siteModel.updateById(siteId, { siteName, siteUrl });

        if (updated) {
            res.redirect('/admin/sites?success=Site updated successfully');
        } else {
            res.redirect('/admin/sites?error=Site not found');
        }
    } catch (error) {
        console.error('Error updating site:', error);
        res.redirect('/admin/sites?error=Failed to update site');
    }
});

// Delete site endpoint
router.post('/delete-site', isAdmin, async (req, res) => {
    try {
        const { siteId } = req.body;

        if (!siteId) {
            return res.redirect('/admin/sites?error=Site ID is required');
        }

        const siteModel = new Sites();
        const deleted = await siteModel.deleteById(siteId);

        if (deleted) {
            res.redirect('/admin/sites?success=Site deleted successfully');
        } else {
            res.redirect('/admin/sites?error=Site not found');
        }
    } catch (error) {
        console.error('Error deleting site:', error);
        res.redirect('/admin/sites?error=Failed to delete site');
    }
});

// Update settings endpoint
router.post('/update-settings', isAdmin, async (req, res) => {
    try {
        // Handle settings update logic here
        console.log('Settings update:', req.body);

        res.redirect('/admin/settings?success=Settings updated successfully');
    } catch (error) {
        console.error(error);
        res.redirect('/admin/settings?error=Failed to update settings');
    }
});


export default router