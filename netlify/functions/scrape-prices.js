const https = require('https');

const PRODUCTS = [
  { url: 'https://www.berwickbullion.com.au/product/germania-mint-1g-gold-minted-bar/', category: 'gold' },
  { url: 'https://www.berwickbullion.com.au/product/germania-mint-2025-malta-golden-eagle-1-10oz-gold-coin/', category: 'gold' },
  { url: 'https://www.berwickbullion.com.au/product/perth-mint-year-of-the-rabbit-2023-1-20oz-gold-bullion-coin/', category: 'gold' },
  { url: 'https://www.berwickbullion.com.au/product/buffalo-1oz-silver-round-in-capsule-1oz/', category: 'silver' },
  { url: 'https://www.berwickbullion.com.au/product/generic-5oz-silver-cast-bars/', category: 'silver' },
  { url: 'https://www.berwickbullion.com.au/product/buffalo-1oz-silver-round-in-tube-20oz/', category: 'silver' },
  { url: 'https://www.berwickbullion.com.au/product/new-zealand-mint-1oz-silver-fern-round/', category: 'silver' },
  { url: 'https://www.berwickbullion.com.au/product/new-zealand-mint-1oz-silver-fern-round-in-tube/', category: 'silver' },
  { url: 'https://www.berwickbullion.com.au/product/perth-mint-2022-australian-koala-1oz-silver-coin-in-capsule/', category: 'silver' },
  { url: 'https://www.berwickbullion.com.au/product/perth-mint-2023-australian-koala-1oz-silver-coin-in-capsule-1oz/', category: 'silver' },
  { url: 'https://www.berwickbullion.com.au/product/perth-mint-2024-year-of-the-dragon-1-2oz-silver-coin-in-capsule-1-2oz/', category: 'silver' },
  { url: 'https://www.berwickbullion.com.au/product/perth-mint-2025-year-of-the-snake-2oz-silver-coin-in-capsule-2oz/', category: 'silver' },
  { url: 'https://www.berwickbullion.com.au/product/perth-mint-2026-australian-kookaburra-1oz-silver-coin/', category: 'silver' },
  { url: 'https://www.berwickbullion.com.au/product/scottsdale-mint-10oz-chunky-silver-cast-bar/', category: 'silver' },
  { url: 'https://www.berwickbullion.com.au/product/silvertowne-mint-buffalo-10oz-silver-bar/', category: 'silver' },
  { url: 'https://www.berwickbullion.com.au/product/xag-10oz-silver-minted-bar/', category: 'silver' },
];

const MARKUP = 1.20;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'TCTBULLION/tct-bullion';

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function extract(html, property) {
  const re = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

function extractName(html) {
  const m = html.match(/<h1[^>]*class=["'][^"']*product_title[^"']*["'][^>]*>([^<]+)<\/h1>/i);
  return m ? m[1].trim() : null;
}

function extractAvailable(html) {
  const m = html.match(/<meta[^>]+property=["']product:availability["'][^>]+content=["']([^"']+)["']/i);
  if (m) return m[1].toLowerCase().replace(/\s/g,'') === 'instock';
  return !html.includes('Out of stock');
}

function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'CommonwealthCache-Scraper',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function scrapeProduct(item) {
  try {
    const html = await fetchPage(item.url);
    const name = extractName(html);
    const priceStr = extract(html, 'product:price:amount');
    const image = extract(html, 'og:image');
    const available = extractAvailable(html);
    const berwickPrice = priceStr ? parseFloat(priceStr) : null;
    const ourPrice = berwickPrice ? Math.ceil(berwickPrice * MARKUP * 100) / 100 : null;
    return { name: name || 'Unknown', url: item.url, category: item.category, image: image || '', available, berwickPrice, ourPrice, lastUpdated: new Date().toISOString() };
  } catch (err) {
    console.error(`Failed: ${item.url} — ${err.message}`);
    return null;
  }
}

exports.handler = async function(event, context) {
  console.log('Starting price scrape...');

  const results = [];
  for (const item of PRODUCTS) {
    const product = await scrapeProduct(item);
    if (product) {
      results.push(product);
      console.log(`OK: ${product.name} — $${product.ourPrice}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const data = { lastUpdated: new Date().toISOString(), products: results };
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');

  // Get current file SHA from GitHub
  const current = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/prices.json`);
  
  // Update prices.json in GitHub repo
  await githubRequest('PUT', `/repos/${GITHUB_REPO}/contents/prices.json`, {
    message: 'Auto-update prices',
    content: content,
    sha: current.sha
  });

  console.log(`Done — ${results.length} products, prices.json updated in GitHub`);
  return { statusCode: 200, body: JSON.stringify({ success: true, count: results.length }) };
};
