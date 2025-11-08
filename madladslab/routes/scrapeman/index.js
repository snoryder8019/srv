import express from "express";
const router = express.Router();
import { scrapeUrl, analyzeContent, extractStructuredData } from "../../lib/scraper.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Scrapeman main interface
router.get('/', async (req, res) => {
    try {
        const user = req.user;
        res.render("scrapeman/index", {
            user: user,
            title: "ScapeMan - Web Scraper Utility"
        });
    } catch (error) {
        console.error('Scrapeman error:', error);
        res.status(500).send('Internal Server Error');
    }
});

// API endpoint to scrape a URL
router.post('/api/scrape', async (req, res) => {
    try {
        const { url, options } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }

        // Validate URL format
        try {
            new URL(url);
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL format'
            });
        }

        const result = await scrapeUrl(url, options);
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Scrape error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint to analyze scraped content
router.post('/api/analyze', async (req, res) => {
    try {
        const { html, analysisType } = req.body;

        if (!html) {
            return res.status(400).json({
                success: false,
                error: 'HTML content is required'
            });
        }

        const analysis = await analyzeContent(html, analysisType);
        res.json({
            success: true,
            analysis: analysis
        });
    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint to extract structured data
router.post('/api/extract', async (req, res) => {
    try {
        const { html, selectors } = req.body;

        if (!html) {
            return res.status(400).json({
                success: false,
                error: 'HTML content is required'
            });
        }

        const extracted = await extractStructuredData(html, selectors);
        res.json({
            success: true,
            data: extracted
        });
    } catch (error) {
        console.error('Extraction error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint to get page metadata
router.post('/api/metadata', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }

        const result = await scrapeUrl(url, { metadataOnly: true });
        res.json({
            success: true,
            metadata: result.metadata
        });
    } catch (error) {
        console.error('Metadata error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint to get all local apps
router.get('/api/local-apps', async (req, res) => {
    try {
        const apps = [
            { name: 'madladslab', port: 3000, dir: '/srv/madladslab', url: 'http://localhost:3000' },
            { name: 'ps (Stringborne)', port: 3399, dir: '/srv/ps', url: 'http://localhost:3399' },
            { name: 'game-state', port: 3500, dir: '/srv/game-state-service', url: 'http://localhost:3500' },
            { name: 'acm', port: 3004, dir: '/srv/acm', url: 'http://localhost:3004' },
            { name: 'nocometalworkz', port: 3002, dir: '/srv/nocometalworkz', url: 'http://localhost:3002' },
            { name: 'sfg', port: 3003, dir: '/srv/sfg', url: 'http://localhost:3003' },
            { name: 'sna', port: 3010, dir: '/srv/sna', url: 'http://localhost:3010' },
            { name: 'twww', port: 3005, dir: '/srv/twww', url: 'http://localhost:3005' },
            { name: 'w2portal', port: 3006, dir: '/srv/w2MongoClient', url: 'http://localhost:3006' },
            { name: 'madThree', port: 3007, dir: '/srv/madThree', url: 'http://localhost:3007' },
            { name: 'graffitiTV', port: 3008, dir: '/srv/graffiti-tv', url: 'http://localhost:3008' }
        ];

        res.json({
            success: true,
            apps: apps
        });
    } catch (error) {
        console.error('Local apps error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint to scan app for images and assets
router.post('/api/scan-app', async (req, res) => {
    try {
        const { appDir } = req.body;

        if (!appDir) {
            return res.status(400).json({
                success: false,
                error: 'App directory is required'
            });
        }

        // Security check - only allow /srv directories
        if (!appDir.startsWith('/srv/')) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        const publicDir = path.join(appDir, 'public');
        const assets = await scanDirectory(publicDir);

        res.json({
            success: true,
            assets: assets
        });
    } catch (error) {
        console.error('Scan app error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint to get scraped images from /public/imageScrape
router.get('/api/scraped-images', async (req, res) => {
    try {
        const imageScrapeDir = path.join(__dirname, '../../public/imageScrape');

        try {
            const files = await fs.readdir(imageScrapeDir);
            const imageFiles = files.filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp'].includes(ext);
            });

            const images = imageFiles.map(file => ({
                filename: file,
                url: `/imageScrape/${file}`
            }));

            res.json({
                success: true,
                images: images,
                count: images.length
            });
        } catch (error) {
            // Directory doesn't exist or is empty
            res.json({
                success: true,
                images: [],
                count: 0
            });
        }
    } catch (error) {
        console.error('Get scraped images error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint to save scraped images
router.post('/api/save-images', async (req, res) => {
    try {
        const { images } = req.body;

        if (!images || !Array.isArray(images)) {
            return res.status(400).json({
                success: false,
                error: 'Images array is required'
            });
        }

        const imageScrapeDir = path.join(__dirname, '../../public/imageScrape');

        // Ensure directory exists
        try {
            await fs.access(imageScrapeDir);
        } catch {
            await fs.mkdir(imageScrapeDir, { recursive: true });
        }

        const savedImages = [];
        const errors = [];

        for (const imgUrl of images) {
            try {
                // Download image
                const response = await axios.get(imgUrl, {
                    responseType: 'arraybuffer',
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                // Extract filename from URL
                const urlPath = new URL(imgUrl).pathname;
                let filename = path.basename(urlPath);

                // If no extension, try to detect from content-type
                if (!path.extname(filename)) {
                    const contentType = response.headers['content-type'];
                    const ext = contentType?.split('/')[1]?.split(';')[0];
                    if (ext) {
                        filename = `${filename}.${ext}`;
                    }
                }

                // Sanitize filename
                filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

                const filepath = path.join(imageScrapeDir, filename);

                // Save image
                await fs.writeFile(filepath, Buffer.from(response.data));

                savedImages.push({
                    original: imgUrl,
                    saved: `/imageScrape/${filename}`,
                    filename: filename
                });

            } catch (error) {
                console.error(`Error saving image ${imgUrl}:`, error.message);
                errors.push({
                    url: imgUrl,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            saved: savedImages,
            errors: errors,
            message: `Saved ${savedImages.length} of ${images.length} images`
        });

    } catch (error) {
        console.error('Save images error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper function to recursively scan directory for assets
async function scanDirectory(dir, basePath = '') {
    const assets = {
        images: [],
        stylesheets: [],
        scripts: [],
        other: []
    };

    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.join(basePath, entry.name);

            if (entry.isDirectory()) {
                // Recursively scan subdirectories
                const subAssets = await scanDirectory(fullPath, relativePath);
                assets.images.push(...subAssets.images);
                assets.stylesheets.push(...subAssets.stylesheets);
                assets.scripts.push(...subAssets.scripts);
                assets.other.push(...subAssets.other);
            } else {
                const ext = path.extname(entry.name).toLowerCase();
                const stats = await fs.stat(fullPath);

                const asset = {
                    name: entry.name,
                    path: relativePath,
                    fullPath: fullPath,
                    size: stats.size,
                    modified: stats.mtime
                };

                // Categorize by file type
                if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp'].includes(ext)) {
                    assets.images.push(asset);
                } else if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
                    assets.stylesheets.push(asset);
                } else if (['.js', '.mjs', '.ts', '.jsx', '.tsx'].includes(ext)) {
                    assets.scripts.push(asset);
                } else if (['.json', '.xml', '.txt', '.md', '.pdf', '.woff', '.woff2', '.ttf', '.eot', '.otf'].includes(ext)) {
                    assets.other.push(asset);
                }
            }
        }
    } catch (error) {
        console.error(`Error scanning directory ${dir}:`, error.message);
    }

    return assets;
}

export default router;
