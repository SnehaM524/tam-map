// Vercel serverless function: POST /api/generate
// Body: { "niche": "campground reservation software", "geography": "Oregon" }
// Returns a TAM-map config (same shape the page's "Copy config as JSON" button emits).

import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const PER_IP_PER_DAY = Number(process.env.RATE_LIMIT_PER_IP || 5);
const GLOBAL_PER_DAY = Number(process.env.RATE_LIMIT_GLOBAL || 200);

// In-memory limiter. Serverless instances don't share memory, so this is a
// deterrent rather than a hard wall. Swap for Vercel KV / Upstash if it matters.
const hits = new Map();
let globalCount = 0;
let globalDay = today();
function today() { return new Date().toISOString().slice(0, 10); }
function limited(ip) {
  const d = today();
  if (d !== globalDay) { globalDay = d; globalCount = 0; hits.clear(); }
  if (globalCount >= GLOBAL_PER_DAY) return "The daily generation limit for this demo has been reached. Try again tomorrow.";
  const n = hits.get(ip) || 0;
  if (n >= PER_IP_PER_DAY) return `You've used today's ${PER_IP_PER_DAY} generations. Try again tomorrow.`;
  hits.set(ip, n + 1); globalCount++;
  return null;
}

const CONFIG_TOOL = {
  name: "tam_config",
  description: "A total-addressable-market map config for one vertical niche: buyer, sizing inputs, an account list with sizes and coordinates, the channels that reach the buyer, and a tier rule.",
  input_schema: {
    type: "object",
    required: ["label", "title", "lede", "buyer", "unit", "price", "priceLabel", "geo", "tamPop", "tamPopLabel", "share", "shareLabel", "shareHint", "t1km", "t2km", "sizeLabel", "mapLede", "home", "accounts", "channels", "otherChannels", "acctNote", "chanNote", "sources"],
    properties: {
      label: { type: "string", description: "Short tab label, 1-3 words" },
      title: { type: "string", description: "Page title, e.g. 'Oregon Campground TAM Map'" },
      lede: { type: "string", description: "Two sentences: what the product sells, to whom, and what the map plots." },
      buyer: { type: "string", description: "Who signs and who uses it, one sentence." },
      unit: { type: "string", description: "Unit of value, e.g. 'One campground on subscription'" },
      price: { type: "number", description: "Typical revenue per unit per year, USD" },
      priceLabel: { type: "string" },
      geo: { type: "string", description: "Geography this run covers" },
      tamPop: { type: "number", description: "Total count of units in the geography (best public estimate)" },
      tamPopLabel: { type: "string", description: "What tamPop counts and its source year" },
      share: { type: "number", description: "Percent of units that realistically qualify (0-100)" },
      shareLabel: { type: "string" },
      shareHint: { type: "string", description: "Why that share, and what data would replace the assumption" },
      t1km: { type: "number", description: "Tier 1 drive band in km from the home base" },
      t2km: { type: "number", description: "Tier 2 drive band in km" },
      sizeLabel: { type: "string", description: "What the account size column counts, e.g. 'Sites', 'Players', 'Students'" },
      mapLede: { type: "string" },
      home: {
        type: "object", required: ["name", "lat", "lng"],
        properties: { name: { type: "string", description: "A sensible starting point: the largest metro or the most concentrated cluster of accounts" }, lat: { type: "number" }, lng: { type: "number" } }
      },
      accounts: {
        type: "array", minItems: 12, maxItems: 30,
        description: "Real, named accounts in the geography with approximate size and coordinates. Prefer well-known entities whose size is public.",
        items: {
          type: "object", required: ["name", "cities", "size", "approx", "lat", "lng"],
          properties: {
            name: { type: "string" }, cities: { type: "string", description: "City or area" },
            size: { type: "number" }, approx: { type: "boolean", description: "true unless the size is a published exact figure" },
            lat: { type: "number" }, lng: { type: "number" }
          }
        }
      },
      channels: {
        type: "array", minItems: 8, maxItems: 30,
        description: "Real venues, associations or organizations that already reach the buyer, with coordinates.",
        items: {
          type: "object", required: ["name", "sys", "type", "city", "lat", "lng"],
          properties: {
            name: { type: "string" }, sys: { type: "string", description: "Parent system or organization" },
            type: { type: "string", description: "Short venue type, e.g. 'library', 'association', 'state park'" },
            city: { type: "string" }, lat: { type: "number" }, lng: { type: "number" }
          }
        }
      },
      otherChannels: {
        type: "array", maxItems: 4,
        description: "Channel types that are not plotted as points",
        items: { type: "object", required: ["name", "count", "note"], properties: { name: { type: "string" }, count: { type: "string" }, note: { type: "string" } } }
      },
      acctNote: { type: "string", description: "Where the account list comes from and what the size column means" },
      chanNote: { type: "string", description: "Where the channel list comes from" },
      sources: {
        type: "array", maxItems: 8,
        description: "Public sources for the counts used, as [title, url] pairs. Only include URLs you are confident exist.",
        items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 }
      }
    }
  }
};

const SYSTEM = `You build total-addressable-market maps for vertical market software companies that sell to Main Street businesses (campgrounds, youth sports leagues, schools, clinics, local government).

Given a niche and a geography, return one tam_config. Rules:
- Use real, named accounts and venues in the geography. Sizes and coordinates may be approximate; mark approx=true unless the figure is published.
- Coordinates must be plausible for the named place (lat/lng in decimal degrees).
- The channels are the places and organizations the buyer already trusts, not ad platforms.
- tamPop and share are your best public estimates; say in the labels and hints where the number comes from and what would replace the assumption.
- Choose t1km and t2km to fit the geography: tighter for a metro, wider for a state.
- Keep copy plain and specific. No marketing language.`;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  const limitMsg = limited(ip);
  if (limitMsg) return res.status(429).json({ error: limitMsg });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const niche = String(body?.niche || "").trim().slice(0, 200);
  const geography = String(body?.geography || "").trim().slice(0, 120);
  if (niche.length < 3) return res.status(400).json({ error: "Describe the niche in a few words." });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools: [CONFIG_TOOL],
      tool_choice: { type: "tool", name: "tam_config" },
      messages: [{ role: "user", content: `Niche: ${niche}\nGeography: ${geography || "pick the most sensible single state or metro to start with, and say which"}` }]
    });
    const block = msg.content.find(b => b.type === "tool_use" && b.name === "tam_config");
    if (!block) return res.status(502).json({ error: "The model did not return a config. Try rephrasing the niche." });
    const cfg = block.input;
    cfg.generated = true;
    cfg.generatedAt = new Date().toISOString();
    cfg.model = MODEL;
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(cfg);
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ error: err?.message || "Generation failed." });
  }
}
