import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Main scraper function to fetch and parse a URL
 * @param {string} url - The URL to scrape
 * @param {Object} options - Scraping options
 * @returns {Object} - Scraped data
 */
export async function scrapeUrl(url, options = {}) {
    try {
        const {
            includeMetadata = true,
            includeContent = true,
            includeLinks = false,
            includeImages = false,
            metadataOnly = false,
            timeout = 10000
        } = options;

        // Fetch the page
        const response = await axios.get(url, {
            timeout,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Cache-Control': 'max-age=0'
            },
            maxRedirects: 5,
            validateStatus: function (status) {
                return status >= 200 && status < 500; // Accept 4xx errors to handle them properly
            }
        });

        // Check if request was successful
        if (response.status >= 400) {
            const errorMessages = {
                403: 'Access forbidden - The website is blocking scraper requests. Try a different URL or website.',
                404: 'Page not found - The URL does not exist.',
                429: 'Too many requests - The website is rate limiting. Try again later.',
                500: 'Server error - The target website is experiencing issues.',
                503: 'Service unavailable - The target website is temporarily down.'
            };

            throw new Error(errorMessages[response.status] || `HTTP ${response.status} - ${response.statusText}`);
        }

        const html = response.data;
        const $ = cheerio.load(html);

        const result = {
            url: url,
            statusCode: response.status,
            scrapedAt: new Date().toISOString()
        };

        // Extract metadata
        if (includeMetadata || metadataOnly) {
            result.metadata = extractMetadata($);
        }

        if (metadataOnly) {
            return result;
        }

        // Extract content
        if (includeContent) {
            result.content = extractContent($);
        }

        // Extract links
        if (includeLinks) {
            result.links = extractLinks($, url);
        }

        // Extract images
        if (includeImages) {
            result.images = extractImages($, url);
        }

        return result;
    } catch (error) {
        throw new Error(`Scraping failed: ${error.message}`);
    }
}

/**
 * Extract metadata from the page
 * @param {CheerioStatic} $ - Cheerio instance
 * @returns {Object} - Metadata object
 */
function extractMetadata($) {
    const metadata = {
        title: $('title').text() || $('meta[property="og:title"]').attr('content') || '',
        description: $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '',
        keywords: $('meta[name="keywords"]').attr('content') || '',
        author: $('meta[name="author"]').attr('content') || '',
        image: $('meta[property="og:image"]').attr('content') || '',
        canonical: $('link[rel="canonical"]').attr('href') || '',
        robots: $('meta[name="robots"]').attr('content') || '',
        language: $('html').attr('lang') || $('meta[property="og:locale"]').attr('content') || ''
    };

    // Extract Open Graph tags
    metadata.openGraph = {};
    $('meta[property^="og:"]').each((i, elem) => {
        const property = $(elem).attr('property');
        const content = $(elem).attr('content');
        if (property && content) {
            metadata.openGraph[property.replace('og:', '')] = content;
        }
    });

    // Extract Twitter Card tags
    metadata.twitter = {};
    $('meta[name^="twitter:"]').each((i, elem) => {
        const name = $(elem).attr('name');
        const content = $(elem).attr('content');
        if (name && content) {
            metadata.twitter[name.replace('twitter:', '')] = content;
        }
    });

    return metadata;
}

/**
 * Extract main content from the page
 * @param {CheerioStatic} $ - Cheerio instance
 * @returns {Object} - Content object
 */
function extractContent($) {
    // Remove script, style, and nav elements
    $('script, style, nav, header, footer, aside').remove();

    const content = {
        title: $('h1').first().text().trim() || $('title').text().trim(),
        headings: [],
        paragraphs: [],
        text: ''
    };

    // Extract headings
    $('h1, h2, h3, h4, h5, h6').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text) {
            content.headings.push({
                level: elem.tagName.toLowerCase(),
                text: text
            });
        }
    });

    // Extract paragraphs
    $('p').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text && text.length > 20) {
            content.paragraphs.push(text);
        }
    });

    // Extract main text (prioritize main, article, or body content)
    const mainContent = $('main, article, [role="main"]').first();
    if (mainContent.length) {
        content.text = mainContent.text().trim().replace(/\s+/g, ' ');
    } else {
        content.text = $('body').text().trim().replace(/\s+/g, ' ');
    }

    // Limit text length
    if (content.text.length > 10000) {
        content.text = content.text.substring(0, 10000) + '...';
    }

    return content;
}

/**
 * Extract all links from the page
 * @param {CheerioStatic} $ - Cheerio instance
 * @param {string} baseUrl - Base URL for relative links
 * @returns {Array} - Array of link objects
 */
function extractLinks($, baseUrl) {
    const links = [];
    const seen = new Set();

    $('a[href]').each((i, elem) => {
        let href = $(elem).attr('href');
        const text = $(elem).text().trim();

        if (!href) return;

        // Convert relative URLs to absolute
        try {
            const url = new URL(href, baseUrl);
            href = url.href;
        } catch (e) {
            return; // Skip invalid URLs
        }

        // Avoid duplicates
        if (seen.has(href)) return;
        seen.add(href);

        links.push({
            url: href,
            text: text || '',
            rel: $(elem).attr('rel') || '',
            target: $(elem).attr('target') || ''
        });
    });

    return links;
}

/**
 * Extract all images from the page
 * @param {CheerioStatic} $ - Cheerio instance
 * @param {string} baseUrl - Base URL for relative image paths
 * @returns {Array} - Array of image objects
 */
function extractImages($, baseUrl) {
    const images = [];
    const seen = new Set();

    $('img[src]').each((i, elem) => {
        let src = $(elem).attr('src');

        if (!src) return;

        // Convert relative URLs to absolute
        try {
            const url = new URL(src, baseUrl);
            src = url.href;
        } catch (e) {
            return; // Skip invalid URLs
        }

        // Avoid duplicates
        if (seen.has(src)) return;
        seen.add(src);

        images.push({
            src: src,
            alt: $(elem).attr('alt') || '',
            title: $(elem).attr('title') || '',
            width: $(elem).attr('width') || '',
            height: $(elem).attr('height') || ''
        });
    });

    return images;
}

/**
 * Analyze content for patterns or specific data
 * @param {string} html - HTML content
 * @param {string} analysisType - Type of analysis to perform
 * @returns {Object} - Analysis results
 */
export async function analyzeContent(html, analysisType = 'general') {
    const $ = cheerio.load(html);

    const analysis = {
        type: analysisType,
        timestamp: new Date().toISOString()
    };

    switch (analysisType) {
        case 'seo':
            analysis.results = analyzeSEO($);
            break;
        case 'accessibility':
            analysis.results = analyzeAccessibility($);
            break;
        case 'performance':
            analysis.results = analyzePerformance($);
            break;
        default:
            analysis.results = analyzeGeneral($);
    }

    return analysis;
}

function analyzeSEO($) {
    return {
        hasTitle: $('title').length > 0,
        titleLength: $('title').text().length,
        hasDescription: $('meta[name="description"]').length > 0,
        descriptionLength: $('meta[name="description"]').attr('content')?.length || 0,
        h1Count: $('h1').length,
        h2Count: $('h2').length,
        hasCanonical: $('link[rel="canonical"]').length > 0,
        imageCount: $('img').length,
        imagesWithAlt: $('img[alt]').length,
        internalLinks: $('a[href^="/"]').length,
        externalLinks: $('a[href^="http"]').length
    };
}

function analyzeAccessibility($) {
    return {
        imagesWithoutAlt: $('img:not([alt])').length,
        linksWithoutText: $('a:not(:has(*)):empty').length,
        hasLangAttribute: $('html[lang]').length > 0,
        ariaLabels: $('[aria-label]').length,
        landmarkRoles: $('[role="main"], [role="navigation"], [role="banner"]').length,
        headingStructure: {
            h1: $('h1').length,
            h2: $('h2').length,
            h3: $('h3').length,
            h4: $('h4').length,
            h5: $('h5').length,
            h6: $('h6').length
        }
    };
}

function analyzePerformance($) {
    return {
        totalElements: $('*').length,
        scriptTags: $('script').length,
        externalScripts: $('script[src]').length,
        stylesheets: $('link[rel="stylesheet"]').length,
        inlineStyles: $('style').length,
        images: $('img').length,
        iframes: $('iframe').length,
        formElements: $('form').length
    };
}

function analyzeGeneral($) {
    return {
        wordCount: $('body').text().split(/\s+/).filter(word => word.length > 0).length,
        paragraphCount: $('p').length,
        linkCount: $('a').length,
        imageCount: $('img').length,
        listCount: $('ul, ol').length,
        tableCount: $('table').length,
        headingCount: $('h1, h2, h3, h4, h5, h6').length
    };
}

/**
 * Extract structured data using CSS selectors
 * @param {string} html - HTML content
 * @param {Object} selectors - Object with key-selector pairs
 * @returns {Object} - Extracted data
 */
export async function extractStructuredData(html, selectors = {}) {
    const $ = cheerio.load(html);
    const results = {};

    for (const [key, selector] of Object.entries(selectors)) {
        const elements = $(selector);

        if (elements.length === 0) {
            results[key] = null;
            continue;
        }

        if (elements.length === 1) {
            results[key] = elements.text().trim();
        } else {
            results[key] = elements.map((i, elem) => $(elem).text().trim()).get();
        }
    }

    return results;
}

export default {
    scrapeUrl,
    analyzeContent,
    extractStructuredData
};
