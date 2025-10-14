import fetch from 'node-fetch';
import { load } from 'cheerio';

/**
 * NewsAPI.org fallback - requires API key (free tier: 100 requests/day)
 * Sign up at https://newsapi.org to get API key
 * Set environment variable: NEWS_API_KEY=your_key_here
 */
const NEWS_API_KEY = process.env.NEWS_API_KEY || null;

/**
 * Fallback to NewsAPI.org if scraping fails
 */
const getNewsAPIFallback = async (source) => {
  if (!NEWS_API_KEY) return [];

  const sourceMap = {
    'cnn': 'cnn',
    'fox': 'fox-news',
    'bbc': 'bbc-news',
    'reuters': 'reuters',
    'ap': 'associated-press'
  };

  try {
    const apiSource = sourceMap[source];
    if (!apiSource) return [];

    const res = await fetch(
      `https://newsapi.org/v2/top-headlines?sources=${apiSource}&apiKey=${NEWS_API_KEY}`
    );
    const data = await res.json();

    if (data.status === 'ok' && data.articles) {
      return data.articles.slice(0, 10).map(article => ({
        title: article.title,
        url: article.url,
        image: article.urlToImage,
        description: article.description,
        source: source.toUpperCase(),
        publishedAt: article.publishedAt
      }));
    }
    return [];
  } catch (error) {
    console.error(`NewsAPI fallback error for ${source}:`, error.message);
    return [];
  }
};

/**
 * Extract image from article card or link
 */
const extractImage = ($el) => {
  // Try to find img within the element
  let img = $el.find('img').first().attr('src');

  // Try parent/sibling img
  if (!img) {
    img = $el.closest('article, div').find('img').first().attr('src');
  }

  // Try data attributes
  if (!img) {
    img = $el.find('img').first().attr('data-src') ||
          $el.find('img').first().attr('data-lazy-src');
  }

  return img || null;
};

/**
 * CNN News Scraper with images
 */
export const getCNNNews = async () => {
  try {
    const res = await fetch('https://www.cnn.com');
    const html = await res.text();
    const $ = load(html);
    const headlines = [];

    // Look for article containers with images
    $('article, div[class*="card"]').each((_, article) => {
      const $article = $(article);
      const $link = $article.find('a').first();
      const $heading = $article.find('h2, h3').first();
      const text = $heading.text().trim();
      const url = $link.attr('href');
      const image = extractImage($article);

      if (text && text.length > 20 && url) {
        headlines.push({
          title: text,
          url: url?.startsWith('http') ? url : `https://www.cnn.com${url}`,
          image: image?.startsWith('http') ? image : (image ? `https://www.cnn.com${image}` : null),
          source: 'CNN'
        });
      }
    });

    // Fallback to simple headline extraction if no articles found
    if (headlines.length === 0) {
      $('a:has(h3), a:has(h2)').each((_, el) => {
        const $el = $(el);
        const text = $el.text().trim();
        const url = $el.attr('href');
        const image = extractImage($el);

        if (text && text.length > 20) {
          headlines.push({
            title: text,
            url: url?.startsWith('http') ? url : `https://www.cnn.com${url}`,
            image: image?.startsWith('http') ? image : (image ? `https://www.cnn.com${image}` : null),
            source: 'CNN'
          });
        }
      });
    }

    const uniqueHeadlines = [...new Map(headlines.map(h => [h.title, h])).values()].slice(0, 10);

    // Try NewsAPI fallback if scraping returned nothing
    if (uniqueHeadlines.length === 0) {
      return await getNewsAPIFallback('cnn');
    }

    return uniqueHeadlines;
  } catch (error) {
    console.error('CNN scraper error:', error.message);
    // Try NewsAPI fallback on error
    return await getNewsAPIFallback('cnn');
  }
};

/**
 * Fox News Scraper with images
 */
export const getFoxNews = async () => {
  try {
    const res = await fetch('https://www.foxnews.com');
    const html = await res.text();
    const $ = load(html);
    const headlines = [];

    $('article').each((_, article) => {
      const $article = $(article);
      const $heading = $article.find('h2, h3').first();
      const $link = $article.find('a').first();
      const text = $heading.text().trim();
      const url = $link.attr('href') || $heading.parent('a').attr('href');
      const image = extractImage($article);

      if (text && text.length > 20 && url) {
        headlines.push({
          title: text,
          url: url?.startsWith('http') ? url : `https://www.foxnews.com${url}`,
          image: image?.startsWith('http') ? image : (image ? `https://www.foxnews.com${image}` : null),
          source: 'Fox News'
        });
      }
    });

    const uniqueHeadlines = [...new Map(headlines.map(h => [h.title, h])).values()].slice(0, 10);

    if (uniqueHeadlines.length === 0) {
      return await getNewsAPIFallback('fox');
    }

    return uniqueHeadlines;
  } catch (error) {
    console.error('Fox News scraper error:', error.message);
    return await getNewsAPIFallback('fox');
  }
};

/**
 * BBC News Scraper with images
 */
export const getBBCNews = async () => {
  try {
    const res = await fetch('https://www.bbc.com/news');
    const html = await res.text();
    const $ = load(html);
    const headlines = [];

    $('a[data-testid*="internal-link"]').each((_, link) => {
      const $link = $(link);
      const $heading = $link.find('h2, h3').first();
      const text = $heading.text().trim();
      const url = $link.attr('href');
      const image = extractImage($link);

      if (text && text.length > 20 && url) {
        headlines.push({
          title: text,
          url: url?.startsWith('http') ? url : `https://www.bbc.com${url}`,
          image: image?.startsWith('http') ? image : (image ? `https://www.bbc.com${image}` : null),
          source: 'BBC'
        });
      }
    });

    // Fallback selector
    if (headlines.length === 0) {
      $('h2, h3').each((_, el) => {
        const $el = $(el);
        const text = $el.text().trim();
        const $container = $el.closest('article, div');
        const url = $container.find('a').first().attr('href');
        const image = extractImage($container);

        if (text && text.length > 20 && url) {
          headlines.push({
            title: text,
            url: url?.startsWith('http') ? url : `https://www.bbc.com${url}`,
            image: image?.startsWith('http') ? image : (image ? `https://www.bbc.com${image}` : null),
            source: 'BBC'
          });
        }
      });
    }

    const uniqueHeadlines = [...new Map(headlines.map(h => [h.title, h])).values()].slice(0, 10);

    if (uniqueHeadlines.length === 0) {
      return await getNewsAPIFallback('bbc');
    }

    return uniqueHeadlines;
  } catch (error) {
    console.error('BBC scraper error:', error.message);
    return await getNewsAPIFallback('bbc');
  }
};

/**
 * Associated Press (AP) News Scraper with images
 */
export const getAPNews = async () => {
  try {
    const res = await fetch('https://apnews.com');
    const html = await res.text();
    const $ = load(html);
    const headlines = [];

    $('div[class*="Card"], article').each((_, card) => {
      const $card = $(card);
      const $heading = $card.find('h2, h3, .CardHeadline').first();
      const text = $heading.text().trim();
      const $link = $card.find('a').first();
      const url = $link.attr('href');
      const image = extractImage($card);

      if (text && text.length > 20 && url) {
        headlines.push({
          title: text,
          url: url?.startsWith('http') ? url : `https://apnews.com${url}`,
          image: image?.startsWith('http') ? image : (image ? `https://apnews.com${image}` : null),
          source: 'AP News'
        });
      }
    });

    const uniqueHeadlines = [...new Map(headlines.map(h => [h.title, h])).values()].slice(0, 10);

    if (uniqueHeadlines.length === 0) {
      return await getNewsAPIFallback('ap');
    }

    return uniqueHeadlines;
  } catch (error) {
    console.error('AP News scraper error:', error.message);
    return await getNewsAPIFallback('ap');
  }
};

/**
 * Reuters News Scraper with images
 */
export const getReutersNews = async () => {
  try {
    const res = await fetch('https://www.reuters.com');
    const html = await res.text();
    const $ = load(html);
    const headlines = [];

    $('article, div[class*="story"]').each((_, article) => {
      const $article = $(article);
      const $heading = $article.find('h2, h3, a[data-testid*="Heading"]').first();
      const text = $heading.text().trim();
      const $link = $article.find('a').first();
      const url = $link.attr('href') || $heading.attr('href');
      const image = extractImage($article);

      if (text && text.length > 20 && url) {
        headlines.push({
          title: text,
          url: url?.startsWith('http') ? url : `https://www.reuters.com${url}`,
          image: image?.startsWith('http') ? image : (image ? `https://www.reuters.com${image}` : null),
          source: 'Reuters'
        });
      }
    });

    const uniqueHeadlines = [...new Map(headlines.map(h => [h.title, h])).values()].slice(0, 10);

    if (uniqueHeadlines.length === 0) {
      return await getNewsAPIFallback('reuters');
    }

    return uniqueHeadlines;
  } catch (error) {
    console.error('Reuters scraper error:', error.message);
    return await getNewsAPIFallback('reuters');
  }
};

/**
 * Get all news from multiple sources
 */
export const getAllNews = async () => {
  try {
    const [cnn, fox, bbc, ap, reuters] = await Promise.all([
      getCNNNews(),
      getFoxNews(),
      getBBCNews(),
      getAPNews(),
      getReutersNews()
    ]);

    return {
      cnn,
      fox,
      bbc,
      ap,
      reuters,
      all: [...cnn, ...fox, ...bbc, ...ap, ...reuters]
    };
  } catch (error) {
    console.error('Error fetching all news:', error.message);
    return {
      cnn: [],
      fox: [],
      bbc: [],
      ap: [],
      reuters: [],
      all: []
    };
  }
};
