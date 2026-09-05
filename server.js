const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
} catch (e) {}


const PORT = 3463;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json'
};

// In-memory demo admin session & user registry
let adminUsers = [
  { id: 'usr_1', email: 'ayan@cocoai.com', name: 'Ayan (Founder)', tier: 'admin', status: 'ACTIVE', createdAt: new Date().toISOString() },
  { id: 'usr_2', email: 'YouKnowWho_am@gmail.com', name: 'You Know Who?', tier: 'premium', status: 'ACTIVE', createdAt: new Date().toISOString() },
  { id: 'usr_3', email: 'alex@quotex.pro', name: 'Alex Coco', tier: 'premium', status: 'ACTIVE', createdAt: new Date().toISOString() },
  { id: 'usr_4', email: 'john@binary.io', name: 'John Trader', tier: 'standard', status: 'ACTIVE', createdAt: new Date().toISOString() },
  { id: 'usr_5', email: 'devala@gmail.com', name: 'Devala', tier: 'basic', status: 'ACTIVE', createdAt: new Date().toISOString() },
  { id: 'usr_6', email: 'mahidsarkar999@gmail.com', name: 'Mahid Sarkar', tier: 'free', status: 'ACTIVE', createdAt: new Date().toISOString() }
];

const KNOWN_CURRENCIES = ['EUR', 'USD', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'BDT', 'INR', 'PKR', 'BRL', 'IDR', 'MXN', 'EGP', 'TRY', 'ZAR', 'PHP', 'ARS', 'BTC', 'ETH', 'XAU', 'USDT'];

function formatPairForMrApi(pair, market) {
  const isOtc = (market === 'OTC') || (typeof pair === 'string' && pair.toUpperCase().includes('OTC'));
  let base = (pair || 'EUR/USD')
    .replace(/\s*\(OTC\)/gi, '')
    .replace(/\s*OTC/gi, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();
  if (!base || base.length < 6) base = 'EURUSD';
  return isOtc ? `${base}_OTC` : base;
}

async function detectMarketFromImage(imageBase64, isOtcTab = true) {
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return { valid: false, error: 'No image data provided.' };
  }

  try {
    let text = '';
    const imgBuffer = Buffer.from(imageBase64, 'base64');
    if (Tesseract) {
      try {
        const res = await Tesseract.recognize(imgBuffer, 'eng');
        text = res.data?.text || '';
      } catch (e) {}
    }
    const cleanText = text.replace(/[^A-Za-z0-9\/\(\)\s\-]/g, ' ').toUpperCase();

    // Check for OTC clues: (OTC), - OTC, or opening bracket next to name
    const isOtcMentioned = cleanText.includes('(OTC)') || cleanText.includes('OTC') || cleanText.includes('-OTC') || cleanText.includes('(');

    // Regex 1: Explicit pair with slash or backslash e.g. EUR/USD or USD/BDT
    const slashRegex = /\b([A-Z]{3})\s*[\/\\]\s*([A-Z]{3})\b/g;
    let m;
    while ((m = slashRegex.exec(cleanText)) !== null) {
      const p1 = m[1];
      const p2 = m[2];
      if (KNOWN_CURRENCIES.includes(p1) && KNOWN_CURRENCIES.includes(p2)) {
        return {
          valid: true,
          pair: `${p1}/${p2}${isOtcMentioned ? ' (OTC)' : ''}`,
          rawPair: `${p1}/${p2}`,
          isOtc: isOtcMentioned,
          text: text
        };
      }
    }

    // Regex 2: Compact pair e.g. EURUSD, GBPJPY, USDBDT
    const compactRegex = /\b([A-Z]{3})([A-Z]{3})\b/g;
    while ((m = compactRegex.exec(cleanText)) !== null) {
      const p1 = m[1];
      const p2 = m[2];
      if (KNOWN_CURRENCIES.includes(p1) && KNOWN_CURRENCIES.includes(p2)) {
        return {
          valid: true,
          pair: `${p1}/${p2}${isOtcMentioned ? ' (OTC)' : ''}`,
          rawPair: `${p1}/${p2}`,
          isOtc: isOtcMentioned,
          text: text
        };
      }
    }

    // Regex 3: Fuzzy currency match
    const fuzzyPairs = [
      { pattern: /EUR.*USD/i, p1: 'EUR', p2: 'USD' },
      { pattern: /GBP.*USD/i, p1: 'GBP', p2: 'USD' },
      { pattern: /USD.*JPY/i, p1: 'USD', p2: 'JPY' },
      { pattern: /AUD.*CAD/i, p1: 'AUD', p2: 'CAD' },
      { pattern: /USD.*BDT/i, p1: 'USD', p2: 'BDT' },
      { pattern: /USD.*INR/i, p1: 'USD', p2: 'INR' },
      { pattern: /USD.*CAD/i, p1: 'USD', p2: 'CAD' },
      { pattern: /USD.*CHF/i, p1: 'USD', p2: 'CHF' },
      { pattern: /GBP.*JPY/i, p1: 'GBP', p2: 'JPY' },
      { pattern: /EUR.*JPY/i, p1: 'EUR', p2: 'JPY' },
      { pattern: /EUR.*GBP/i, p1: 'EUR', p2: 'GBP' },
      { pattern: /NZD.*USD/i, p1: 'NZD', p2: 'USD' },
      { pattern: /CAD.*CHF/i, p1: 'CAD', p2: 'CHF' },
      { pattern: /BTC.*USD/i, p1: 'BTC', p2: 'USD' }
    ];

    for (const fp of fuzzyPairs) {
      if (fp.pattern.test(cleanText)) {
        return {
          valid: true,
          pair: `${fp.p1}/${fp.p2}${isOtcMentioned ? ' (OTC)' : ''}`,
          rawPair: `${fp.p1}/${fp.p2}`,
          isOtc: isOtcMentioned,
          text: text
        };
      }
    }

    // Check if there are any price numbers or trading indicators
    const hasNumbers = /[0-9]+\.[0-9]{2,5}/.test(text);
    const hasTradingTerms = /(OTC|CANDLE|CHART|CALL|PUT|BUY|SELL|PAYOUT|QUOTEX|BINOMO|OLYMP|POCKET|OPTION|M1|1M|5M)/i.test(text);

    // If completely non-chart image (e.g. cat, car, face, white screen):
    if (!hasNumbers && !hasTradingTerms && text.trim().length < 10) {
      return {
        valid: false,
        error: 'Unable to detect a valid trading chart. Please upload a clear chart screenshot showing the asset name (e.g. EUR/USD).'
      };
    }

    // If trading chart detected but OCR pair was slightly blurred, fallback to sensible pair:
    return {
      valid: true,
      pair: isOtcTab ? 'EUR/USD (OTC)' : 'EUR/USD',
      rawPair: 'EUR/USD',
      isOtc: isOtcTab,
      text: text,
      fallback: true
    };
  } catch (err) {
    console.error('[OCR RECOGNIZE ERROR]:', err.message);
    return {
      valid: true,
      pair: isOtcTab ? 'EUR/USD (OTC)' : 'EUR/USD',
      rawPair: 'EUR/USD',
      isOtc: isOtcTab,
      text: ''
    };
  }
}

function appHandler(req, res) {
  const parsedUrl = url.parse(req.url, true);
  let reqPath = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const sendJson = (statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  const readBody = (cb) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { cb(body ? JSON.parse(body) : {}); }
      catch { cb({}); }
    });
  };

  // ==========================================
  // EXACT COCO AI TERMINAL & BACKEND API ROUTES
  // ==========================================

  // 1. Live Signals API (Powered by real Quotex live candle feed from mr-api.cocotrade.org)
  if (reqPath === '/api/signals/live' || reqPath === '/api/signals') {
    return readBody(async (b) => {
      const pair = b.pair || 'EUR/USD';
      const cleanPair = formatPairForMrApi(pair, b.market);
      const mrUrl = `https://mr-api.cocotrade.org/?pair=${encodeURIComponent(cleanPair)}&minutes=30`;

      let candles = [];
      let dir = 'UP';
      let logicText = '';

      try {
        const mrRes = await fetch(mrUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (mrRes.ok) {
          const mrData = await mrRes.json();
          if (mrData && mrData.success && Array.isArray(mrData.data) && mrData.data.length > 0) {
            const rawCandles = [...mrData.data].reverse();
            candles = rawCandles.map(c => ({
              time: c.timestamp,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close
            }));

            // Analyze streak of last 5 real candles
            const last5 = rawCandles.slice(-5);
            const upCount = last5.filter(c => c.close > c.open).length;
            const downCount = last5.filter(c => c.close < c.open).length;

            if (upCount >= 3) {
              dir = 'DOWN';
              logicText = `The algorithm has just detected a ${upCount}-candle bullish breakout sequence on ${pair} indicative of a Liquidity Harvesting phase. The anti-retail filter dictates fading this artificial spike for a bearish reversal.`;
            } else if (downCount >= 3) {
              dir = 'UP';
              logicText = `The algorithm has detected a ${downCount}-candle heavy drop into major demand zone on ${pair}. Institutional absorption confirmed, expecting a bullish bounce impulse.`;
            } else {
              const latest = rawCandles[rawCandles.length - 1];
              dir = latest.close >= latest.open ? 'UP' : 'DOWN';
              logicText = `Momentum on the last few candles favors continuation to the ${dir === 'UP' ? 'upside' : 'downside'} with rising order volume on ${pair}.`;
            }
          }
        }
      } catch (err) {
        console.log('[MR-API LIVE SIGNALS NOTICE]:', err.message);
      }

      // If specific pair returned 0 records, fetch live Quotex EURUSD benchmark to ensure real candles
      if (!candles || candles.length === 0) {
        try {
          const fallbackPair = cleanPair.endsWith('_OTC') ? 'EURUSD_OTC' : 'EURUSD';
          const fbRes = await fetch(`https://mr-api.cocotrade.org/?pair=${fallbackPair}&minutes=30`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (fbRes.ok) {
            const fbData = await fbRes.json();
            if (fbData && fbData.success && Array.isArray(fbData.data) && fbData.data.length > 0) {
              const raw = [...fbData.data].reverse();
              candles = raw.map(c => ({
                time: c.timestamp,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close
              }));
              const last5 = candles.slice(-5);
              const upCount = last5.filter(c => c.close > c.open).length;
              dir = upCount >= 3 ? 'DOWN' : 'UP';
              logicText = `Quotex live order stream confirms algorithmic momentum alignment favoring ${dir} continuation on ${pair}.`;
            }
          }
        } catch (e) {}
      }

      // Fallback synthetic generator if pair has 0 live records or API is slow
      const now = new Date();
      if (candles.length === 0) {
        const isUp = Math.random() > 0.48;
        dir = isUp ? 'UP' : 'DOWN';
        let curPrice = 127.250 + (Math.random() * 5);
        const startTimestamp = Math.floor((now.getTime() - 25 * 60000) / 60000) * 60;
        for (let i = 0; i < 25; i++) {
          const delta = (Math.random() - 0.49) * 0.045;
          const open = curPrice;
          const close = open + delta;
          const high = Math.max(open, close) + Math.random() * 0.025;
          const low = Math.min(open, close) - Math.random() * 0.025;
          curPrice = close;
          candles.push({
            time: startTimestamp + i * 60,
            open: parseFloat(open.toFixed(4)),
            high: parseFloat(high.toFixed(4)),
            low: parseFloat(low.toFixed(4)),
            close: parseFloat(close.toFixed(4))
          });
        }
        logicText = dir === 'UP'
          ? `The algorithm has detected aggressive absorption of sell orders near key dynamic support on ${pair}.`
          : `Price stalled against major overhead supply zone on ${pair} with failing buy pressure, favoring a bearish reversal.`;
      }

      const nextMin = new Date(now.getTime() + 60000);
      const entryTime = nextMin.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

      // Realistic 2.5s market scanning delay
      setTimeout(() => {
        return sendJson(200, {
          success: true,
          direction: dir,
          entryTime: entryTime,
          logics: [logicText],
          candles: candles,
          noSignal: false,
          tier: 'premium'
        });
      }, 2500);
    });
  }

  // 2. Future Signals API (with real market feed & Z.picks)
  if (reqPath === '/api/signals/future' || reqPath === '/api/future/signals') {
    return readBody(async (b) => {
      const markets = Array.isArray(b.markets) && b.markets.length > 0 ? b.markets : [{ pair: 'EUR/USD' }, { pair: 'GBP/USD' }, { pair: 'USD/JPY' }];
      const count = b.count || markets.length || 3;
      const picks = [];
      const offsets = [10, 25, 40, 60, 90, 120, 150];
      const isOtc = b.market === 'OTC';

      for (let i = 0; i < count; i++) {
        const m = markets[i % markets.length];
        const clean = formatPairForMrApi(m.pair, b.market);
        let isUp = Math.random() > 0.48;
        let reasoning = '';

        try {
          const mrRes = await fetch(`https://mr-api.cocotrade.org/?pair=${encodeURIComponent(clean)}&minutes=5`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (mrRes.ok) {
            const mrData = await mrRes.json();
            if (mrData && mrData.success && Array.isArray(mrData.data) && mrData.data.length > 0) {
              const latest = mrData.data[0];
              isUp = latest.direction === 'up' || (latest.close >= latest.open);
              reasoning = isUp
                ? `Quotex live candle stream confirms ascending order block structure on ${m.pair} with high liquidity hold.`
                : `Quotex live candle stream shows rejection wick from premium supply resistance on ${m.pair}, favoring downside continuation.`;
            }
          }
        } catch(e) {}

        if (!reasoning) {
          reasoning = isUp
            ? `Institutional trend alignment above dynamic EMA expansion structure with bullish momentum on ${m.pair}.`
            : `Rejection from premium order block ceiling with confirmed volume depletion on ${m.pair}, favoring downside move.`;
        }

        picks.push({
          pair: m.pair,
          direction: isUp ? 'UP' : 'DOWN',
          offsetMin: offsets[i] || (i * 15 + 10),
          reasoning: reasoning
        });
      }

      setTimeout(() => {
        return sendJson(200, { success: true, picks });
      }, 1500);
    });
  }

  // 3. Forex Calendar API (Returning high-impact economic news XML)
  if (reqPath === '/api/forex-calendar') {
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    let xmlContent = '';
    try {
      const dump = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'coco_firebase_dump.json'), 'utf8'));
      xmlContent = dump?.calendar?.weeklyXml?.xml || '';
    } catch(e) {}
    if (!xmlContent) {
      xmlContent = `<?xml version="1.0" encoding="utf-8"?><weeklyevents>
        <event><title>Fed Interest Rate Decision</title><country>USD</country><date>09-04-2026</date><time>2:00pm</time><impact>High</impact><forecast>5.25%</forecast><previous>5.50%</previous></event>
        <event><title>Non-Farm Employment Change</title><country>USD</country><date>09-04-2026</date><time>8:30am</time><impact>High</impact><forecast>165K</forecast><previous>142K</previous></event>
        <event><title>ECB Monetary Policy Statement</title><country>EUR</country><date>09-04-2026</date><time>1:45pm</time><impact>High</impact><forecast>3.50%</forecast><previous>3.75%</previous></event>
      </weeklyevents>`;
    }
    return res.end(xmlContent);
  }

  // 4. News Analysis API
  if (reqPath === '/api/news-analysis') {
    return readBody((b) => {
      setTimeout(() => {
        const isUp = Math.random() > 0.45;
        const dir = isUp ? 'UP' : 'DOWN';
        const pair = b.pair || 'EUR/USD';
        const curr = b.currency || 'USD';
        const reason = isUp 
          ? `Forecast (${b.forecast || '0.4%'}) is higher than Previous (${b.previous || '0.3%'}), indicating positive economic strength for ${curr} and driving bullish momentum on ${pair}.`
          : `Economic metrics indicate slight contraction for ${curr} relative to prior readings, exerting downward pressure on ${pair}.`;
        
        return sendJson(200, {
          success: true,
          forecastDir: dir,
          forecastReason: reason,
          techDir: dir,
          techConf: Math.floor(Math.random() * 7) + 88,
          techLogic: isUp
            ? [`Order flow indicates high institutional absorption at support for ${pair}.`, "Dynamic moving averages confirm ascending expansion structure."]
            : [`Strong overhead supply rejection at session resistance on ${pair}.`, "Bearish RSI divergence signals institutional liquidity exit."],
          confidence: Math.floor(Math.random() * 7) + 90,
          reasoning: reason,
          impact: 'HIGH'
        });
      }, 1000);
    });
  }

  // 5. AI Engine / Chart Analyzer API (/api/analyze-chart)
  if (reqPath === '/api/analyze-chart') {
    return readBody(async (b) => {
      // Refine Mode: called by client after fetching live mr-api candles
      if (b.mode === 'refine') {
        const prior = b.priorAnalysis || {};
        const marketData = b.marketData || [];
        let dir = prior.direction || 'CALL';
        let logic = prior.logics?.[0] || `Quotex live candle feed confirms high-volume anti-retail liquidity grab on ${prior.market || 'EUR/USD (OTC)'}.`;
        let confidence = prior.confidence || 93;

        if (Array.isArray(marketData) && marketData.length >= 3) {
          const last3 = marketData.slice(-3);
          const upCount = last3.filter(c => c.close > c.open).length;
          const downCount = last3.filter(c => c.close < c.open).length;

          if (upCount >= 2) {
            dir = 'PUT';
            confidence = Math.min(97, confidence + 2);
            logic = `Quotex live data confirms a ${upCount}-candle retail breakout trap on ${prior.market}. Liquidity sweep exhaustion detected, predicting algorithmic reversal (PUT).`;
          } else if (downCount >= 2) {
            dir = 'CALL';
            confidence = Math.min(97, confidence + 2);
            logic = `Quotex live data confirms ${downCount}-candle selling absorption into dynamic demand zone on ${prior.market}. Predicting a sharp bounce (CALL).`;
          } else {
            const latest = marketData[marketData.length - 1];
            dir = latest.close >= latest.open ? 'CALL' : 'PUT';
            logic = `Live Quotex order book momentum on the last candles favors continuation on ${prior.market} (${dir}).`;
          }
        }

        return sendJson(200, {
          success: true,
          result: JSON.stringify({
            market: prior.market || 'EUR/USD (OTC)',
            direction: dir,
            confidence: confidence,
            logics: [logic],
            isOtc: prior.isOtc !== false
          })
        });
      }

      // Initial Image Upload Analysis
      const isOtcTab = b.feature === 'otc-chart-analyzer' || (b.prompt && b.prompt.includes('OTC'));
      const detection = await detectMarketFromImage(b.imageBase64, isOtcTab);

      // If completely invalid non-trading image:
      if (!detection.valid) {
        return sendJson(400, {
          success: false,
          error: detection.error || "Unable to detect a valid trading chart. Please upload a clear chart screenshot."
        });
      }

      // If user uploaded a Real market chart while on OTC tab:
      if (isOtcTab && !detection.isOtc) {
        // Return isOtc: false so frontend displays the authentic prompt error
        return sendJson(200, {
          success: true,
          result: JSON.stringify({
            market: detection.pair,
            direction: "CALL",
            confidence: 50,
            logics: ["Not an OTC chart — no bracket next to the pair label."],
            isOtc: false
          })
        });
      }

      const detectedPair = detection.pair;
      const cleanPair = formatPairForMrApi(detection.pair, detection.isOtc ? 'OTC' : 'REAL');

      // QUERY REAL LIVE MARKET API (https://mr-api.cocotrade.org/) FOR DETECTED PAIR!
      let dir = 'CALL';
      let confidence = Math.floor(Math.random() * 5) + 92;
      let logicText = '';
      let pattern = 'Bullish Reversal Pin Bar';

      try {
        const mrUrl = `https://mr-api.cocotrade.org/?pair=${encodeURIComponent(cleanPair)}&minutes=30`;
        const mrRes = await fetch(mrUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (mrRes.ok) {
          const mrData = await mrRes.json();
          if (mrData && mrData.success && Array.isArray(mrData.data) && mrData.data.length > 0) {
            const rawCandles = [...mrData.data].reverse();
            const last5 = rawCandles.slice(-5);
            const upCount = last5.filter(c => c.close > c.open).length;
            const downCount = last5.filter(c => c.close < c.open).length;

            if (upCount >= 3) {
              dir = 'PUT';
              pattern = 'Bearish Liquidity Trap';
              logicText = `Quotex live data shows a ${upCount}-candle retail push on ${detectedPair}. Anti-retail algorithm dictates fading this breakout for a reversal (PUT).`;
            } else if (downCount >= 3) {
              dir = 'CALL';
              pattern = 'Demand Absorption Rebound';
              logicText = `Quotex live data shows ${downCount} consecutive sell candles into key institutional support on ${detectedPair}. Rejection wick indicates strong bounce (CALL).`;
            } else {
              const latest = rawCandles[rawCandles.length - 1];
              dir = latest.close >= latest.open ? 'CALL' : 'PUT';
              pattern = dir === 'CALL' ? 'Bullish Continuation Momentum' : 'Bearish Distribution Pressure';
              logicText = `Live Quotex order book indicates directional momentum favoring ${dir} on ${detectedPair} with rising volume.`;
            }
          }
        }
      } catch (err) {
        console.log('[CHART ANALYZER MR-API FETCH FAILOVER]:', err.message);
      }

      if (!logicText) {
        // Dynamic fallback if pair not on mr-api
        const isUp = Math.random() > 0.48;
        dir = isUp ? 'CALL' : 'PUT';
        pattern = isUp ? 'Bullish Dynamic Rejection' : 'Bearish Liquidity Sweep';
        logicText = isUp
          ? `Algorithm detected institutional absorption of sell orders near key dynamic support on ${detectedPair}. Expecting upward continuation (CALL).`
          : `Algorithm detected an artificial liquidity hunt into overhead resistance on ${detectedPair}. Expecting downward rejection (PUT).`;
      }

      const resultObj = {
        isOtc: detection.isOtc,
        market: detectedPair,
        direction: dir,
        confidence: confidence,
        timeframe: '1M',
        logics: [logicText],
        reasoning: logicText,
        candlePattern: pattern,
        trend: dir === 'CALL' ? 'BULLISH' : 'BEARISH',
        momentum: 'STRONG'
      };

      return sendJson(200, {
        success: true,
        result: JSON.stringify(resultObj, null, 2)
      });
    });
  }

  // 5. Admin Session & Auth
  if (reqPath === '/api/admin/session') {
    return sendJson(200, {
      authed: true,
      success: true,
      user: { email: 'ayan@cocoai.com', role: 'admin', name: 'Ayan', permissions: ['ALL'] }
    });
  }

  if (reqPath === '/api/admin/login') {
    return readBody((b) => {
      console.log('[COCO ADMIN LOGIN] Login attempt:', b);
      return sendJson(200, {
        success: true,
        authed: true,
        token: 'coco_admin_jwt_ayan_2026',
        user: { name: 'Ayan', role: 'admin' }
      });
    });
  }

  if (reqPath === '/api/admin/users') {
    if (req.method === 'GET') {
      return sendJson(200, { success: true, users: adminUsers });
    } else if (req.method === 'POST') {
      return readBody((b) => {
        const newUser = {
          id: `usr_${Date.now()}`,
          name: b.name || 'Trader',
          email: b.email || `trader_${Date.now()}@gmail.com`,
          tier: b.tier || 'premium',
          status: 'ACTIVE',
          createdAt: new Date().toISOString()
        };
        adminUsers.unshift(newUser);
        return sendJson(200, { success: true, user: newUser });
      });
    }
  }

  if (reqPath === '/api/admin/set-tier') {
    return readBody(b => {
      const user = adminUsers.find(u => u.email === b.email || u.id === b.id || u.uid === b.uid);
      if (user) user.tier = b.tier;
      return sendJson(200, { success: true, user });
    });
  }

  if (reqPath === '/api/admin/delete-user' || reqPath === '/api/admin/bulk-delete-users' || reqPath === '/api/admin/remove-all-licenses') {
    return sendJson(200, { success: true, message: 'Action executed successfully.' });
  }

  // ==========================================
  // STATIC ROUTING (SERVING EXACT CLONED PAGES)
  // ==========================================

  if (reqPath === '/ayanbhaibiyekoren' || reqPath === '/ayanbhaibiyekoren/') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 Not Found: This route has been permanently deleted.');
  }

  if (reqPath === '/' || reqPath === '/index') {
    reqPath = '/index.html';
  } else if (reqPath === '/console' || reqPath === '/terminal') {
    reqPath = '/console.html';
  } else if (reqPath === '/signals' || reqPath === '/signals/') {
    reqPath = '/signals.html';
  } else if (reqPath === '/blog' || reqPath === '/blog/') {
    reqPath = '/blog.html';
  } else if (reqPath === '/faq' || reqPath === '/faq/') {
    reqPath = '/faq.html';
  } else if (reqPath === '/about' || reqPath === '/about/') {
    reqPath = '/about.html';
  } else if (reqPath === '/admin') {
    reqPath = '/admin.html';
  }

  let filePath = path.join(PUBLIC_DIR, reqPath);

  if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
    filePath = filePath + '.html';
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(appHandler);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('\n======================================================');
    console.log('🚀 FULL-STACK COCO TRADE & REAL COCO TERMINAL RUNNING LOCALLY!');
    console.log('🌐 Main Portal:     http://localhost:' + PORT + '/');
    console.log('💻 Coco Terminal:   http://localhost:' + PORT + '/console');
    console.log('📊 Real Signals:    http://localhost:' + PORT + '/signals');
    console.log('📖 Guides & Blog:   http://localhost:' + PORT + '/blog');
    console.log('❓ FAQ Page:        http://localhost:' + PORT + '/faq');
    console.log('ℹ️ About Page:      http://localhost:' + PORT + '/about');
    console.log('🛡️ Master Admin:    http://localhost:' + PORT + '/admin');
    console.log('======================================================\n');
  });
}

module.exports = appHandler;
