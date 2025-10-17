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
        const sites = await siteModel.getAll() || [];

        res.render("admin/sites", {
            user: user,
            sites: sites,
            currentPage: 'sites'
        });
    } catch (error) {
        console.error(error);
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
        await siteModel.create({ siteName, siteUrl });

        res.redirect('/admin/sites?success=Site created successfully');
    } catch (error) {
        console.error(error);
        res.redirect('/admin/sites?error=Failed to create site');
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