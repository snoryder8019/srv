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

// System Monitor route
router.get('/monitor', isAdmin, async (req, res) => {
    try {
        const user = req.user;

        res.render("admin/monitor", {
            user: user,
            currentPage: 'monitor'
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// Analytics API - Get dashboard stats
router.get('/analytics/api/stats', isAdmin, async (req, res) => {
    try {
        const { getDb } = await import('../../plugins/mongo/mongo.js');
        const db = getDb();

        const now = new Date();
        const last24h = new Date(now - 24 * 60 * 60 * 1000);
        const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
        const last30d = new Date(now - 30 * 24 * 60 * 60 * 1000);

        // Get counts
        const [
            totalPageViews,
            pageViews24h,
            totalApiCalls,
            apiCalls24h,
            totalErrors,
            errors24h,
            uniqueVisitors24h
        ] = await Promise.all([
            db.collection('analytics_pageviews').countDocuments(),
            db.collection('analytics_pageviews').countDocuments({ timestamp: { $gte: last24h } }),
            db.collection('analytics_api').countDocuments(),
            db.collection('analytics_api').countDocuments({ timestamp: { $gte: last24h } }),
            db.collection('analytics_errors').countDocuments(),
            db.collection('analytics_errors').countDocuments({ timestamp: { $gte: last24h } }),
            db.collection('analytics_pageviews').distinct('ip', { timestamp: { $gte: last24h } })
        ]);

        res.json({
            success: true,
            stats: {
                pageViews: {
                    total: totalPageViews,
                    last24h: pageViews24h
                },
                apiCalls: {
                    total: totalApiCalls,
                    last24h: apiCalls24h
                },
                errors: {
                    total: totalErrors,
                    last24h: errors24h
                },
                uniqueVisitors: {
                    last24h: uniqueVisitors24h.length
                }
            }
        });
    } catch (error) {
        console.error('Analytics stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Analytics API - Get top pages
router.get('/analytics/api/top-pages', isAdmin, async (req, res) => {
    try {
        const { getDb } = await import('../../plugins/mongo/mongo.js');
        const db = getDb();
        const days = parseInt(req.query.days) || 7;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const topPages = await db.collection('analytics_pageviews').aggregate([
            { $match: { timestamp: { $gte: since } } },
            { $group: { _id: '$path', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]).toArray();

        res.json({ success: true, topPages });
    } catch (error) {
        console.error('Top pages error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Analytics API - Get traffic over time
router.get('/analytics/api/traffic', isAdmin, async (req, res) => {
    try {
        const { getDb } = await import('../../plugins/mongo/mongo.js');
        const db = getDb();
        const days = parseInt(req.query.days) || 7;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const traffic = await db.collection('analytics_pageviews').aggregate([
            { $match: { timestamp: { $gte: since } } },
            {
                $group: {
                    _id: {
                        year: { $year: '$timestamp' },
                        month: { $month: '$timestamp' },
                        day: { $dayOfMonth: '$timestamp' },
                        hour: { $hour: '$timestamp' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } }
        ]).toArray();

        res.json({ success: true, traffic });
    } catch (error) {
        console.error('Traffic data error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Analytics API - Get device breakdown
router.get('/analytics/api/devices', isAdmin, async (req, res) => {
    try {
        const { getDb } = await import('../../plugins/mongo/mongo.js');
        const db = getDb();
        const days = parseInt(req.query.days) || 7;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const devices = await db.collection('analytics_pageviews').aggregate([
            { $match: { timestamp: { $gte: since } } },
            {
                $group: {
                    _id: {
                        browser: '$device.browser',
                        os: '$device.os',
                        deviceType: '$device.deviceType'
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]).toArray();

        res.json({ success: true, devices });
    } catch (error) {
        console.error('Device data error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Analytics API - Get recent errors
router.get('/analytics/api/errors', isAdmin, async (req, res) => {
    try {
        const { getDb } = await import('../../plugins/mongo/mongo.js');
        const db = getDb();
        const limit = parseInt(req.query.limit) || 20;

        const errors = await db.collection('analytics_errors')
            .find({})
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();

        res.json({ success: true, errors });
    } catch (error) {
        console.error('Errors data error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Analytics API - Get API performance
router.get('/analytics/api/performance', isAdmin, async (req, res) => {
    try {
        const { getDb } = await import('../../plugins/mongo/mongo.js');
        const db = getDb();
        const days = parseInt(req.query.days) || 7;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const performance = await db.collection('analytics_api').aggregate([
            { $match: { timestamp: { $gte: since } } },
            {
                $group: {
                    _id: '$path',
                    count: { $sum: 1 },
                    avgResponseTime: { $avg: '$responseTime' },
                    maxResponseTime: { $max: '$responseTime' },
                    errorCount: {
                        $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] }
                    }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 20 }
        ]).toArray();

        res.json({ success: true, performance });
    } catch (error) {
        console.error('Performance data error:', error);
        res.status(500).json({ success: false, error: error.message });
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

// System Monitor API - Get all apps status
router.get('/monitor/api/apps', isAdmin, async (req, res) => {
    try {
        const { getAllAppsStatus } = await import('../../lib/systemMonitor.js');
        const apps = await getAllAppsStatus();
        res.json({ success: true, apps });
    } catch (error) {
        console.error('Apps status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// System Monitor API - Get single app status
router.get('/monitor/api/apps/:appName', isAdmin, async (req, res) => {
    try {
        const { getAppStatus } = await import('../../lib/systemMonitor.js');
        const status = await getAppStatus(req.params.appName);
        res.json({ success: true, ...status });
    } catch (error) {
        console.error('App status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// System Monitor API - Get system stats
router.get('/monitor/api/system', isAdmin, async (req, res) => {
    try {
        const { getSystemStats } = await import('../../lib/systemMonitor.js');
        const stats = await getSystemStats();
        res.json({ success: true, stats });
    } catch (error) {
        console.error('System stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// System Monitor API - Get app logs
router.get('/monitor/api/logs/:appName', isAdmin, async (req, res) => {
    try {
        const { getAppLogs } = await import('../../lib/systemMonitor.js');
        const lines = parseInt(req.query.lines) || 50;
        const logs = await getAppLogs(req.params.appName, lines);
        res.json({ success: true, ...logs });
    } catch (error) {
        console.error('Logs error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// System Monitor API - Restart app
router.post('/monitor/api/restart/:appName', isAdmin, async (req, res) => {
    try {
        const { restartApp } = await import('../../lib/systemMonitor.js');
        const result = await restartApp(req.params.appName);
        res.json(result);
    } catch (error) {
        console.error('Restart error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Service Monitor API - Get service history
router.get('/monitor/api/history/:serviceName', isAdmin, async (req, res) => {
    try {
        const ServiceMonitorLog = (await import('../../api/v1/models/ServiceMonitorLog.js')).default;
        const model = new ServiceMonitorLog();
        const limit = parseInt(req.query.limit) || 100;
        const history = await model.getServiceHistory(req.params.serviceName, limit);
        res.json({ success: true, history });
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Service Monitor API - Get downtime statistics
router.get('/monitor/api/stats/:serviceName', isAdmin, async (req, res) => {
    try {
        const ServiceMonitorLog = (await import('../../api/v1/models/ServiceMonitorLog.js')).default;
        const model = new ServiceMonitorLog();
        const days = parseInt(req.query.days) || 7;
        const stats = await model.getDowntimeStats(req.params.serviceName, days);
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Service Monitor API - Get current monitoring state
router.get('/monitor/api/daemon/status', isAdmin, async (req, res) => {
    try {
        const { getServiceStates } = await import('../../lib/serviceMonitorDaemon.js');
        const states = getServiceStates();
        res.json({ success: true, states, running: true });
    } catch (error) {
        console.error('Daemon status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== LIVE CHATS ADMIN PANEL ====================

// Live Chats - Main admin view
router.get('/livechats', isAdmin, async (req, res) => {
    try {
        const user = req.user;
        res.render("admin/livechats", {
            user: user,
            currentPage: 'livechats'
        });
    } catch (error) {
        console.error('Error rendering livechats page:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Live Chats API - Get all sessions
router.get('/livechats/api/sessions', isAdmin, async (req, res) => {
    try {
        const { getDb } = await import('../../plugins/mongo/mongo.js');
        const db = getDb();
        
        const sessions = await db.collection('livechats')
            .find({})
            .sort({ updatedAt: -1 })
            .toArray();
        
        res.json({ success: true, sessions });
    } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Live Chats API - Get single session details
router.get('/livechats/api/session/:sessionId', isAdmin, async (req, res) => {
    try {
        const { getDb } = await import('../../plugins/mongo/mongo.js');
        const db = getDb();
        
        const session = await db.collection('livechats').findOne({ 
            sessionId: req.params.sessionId 
        });
        
        if (!session) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }
        
        res.json({ success: true, session });
    } catch (error) {
        console.error('Error fetching session:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Live Chats API - Post reply to a session
router.post('/livechats/:sessionId/reply', isAdmin, async (req, res) => {
    try {
        const { getDb } = await import('../../plugins/mongo/mongo.js');
        const db = getDb();
        const { sessionId } = req.params;
        const { message } = req.body;
        
        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, error: 'Message is required' });
        }
        
        const session = await db.collection('livechats').findOne({ sessionId });
        
        if (!session) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }
        
        // Add admin message to the session
        const adminMessage = {
            role: 'admin',
            content: message.trim(),
            timestamp: new Date()
        };
        
        await db.collection('livechats').updateOne(
            { sessionId },
            { 
                $push: { messages: adminMessage },
                $set: { updatedAt: new Date() }
            }
        );
        
        res.json({ success: true, message: 'Reply sent successfully' });
    } catch (error) {
        console.error('Error sending reply:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router