

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const modelsDir = path.join(__dirname, '../../api/v1/models');
const models = {};
async function isAdmin(req, res, next) {
    const user = req.user;
    if (user && user.isAdmin === true) {
        return next();
    } else {
        return res.status(401).send('Unauthorized');
    }
}
// Load all model files except index.js
fs.readdirSync(modelsDir).forEach(file => {
    if (file !== 'index.js' && file.endsWith('.js')) {
        const modelName = path.basename(file, '.js');
        import(path.join(modelsDir, file)).then(module => {
            models[modelName] = module.default || module;
        });
    }
});

// Main admin dashboard route
router.get('/', isAdmin, async (req, res) => {
    try {
        const user = req.user;
        res.render("adminDashboard", { user, models });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// Legacy admin route (keep for backwards compatibility)
router.get('/legacy', isAdmin, async (req, res) => {
    try {
        const user = req.user;
        res.render("admin", { user, models });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// News management route
router.get('/news', isAdmin, async (req, res) => {
    try {
        const user = req.user;
        res.render("adminNews", { user });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// Models management route
router.get('/models', isAdmin, async (req, res) => {
    try {
        const user = req.user;
        res.render("adminModels", { user, models });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// Users management route (placeholder)
router.get('/users', isAdmin, async (req, res) => {
    try {
        const user = req.user;
        res.render("adminDashboard", { user, models });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// Settings route (placeholder)
router.get('/settings', isAdmin, async (req, res) => {
    try {
        const user = req.user;
        res.render("adminDashboard", { user, models });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

export default router;






