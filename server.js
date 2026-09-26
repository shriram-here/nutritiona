/**
 * NutriScope backend
 * ---------------------------------------------------------------
 * A Node.js + Express API implementing the Food & Nutrition
 * Management System described in the design chat: a food database,
 * a nutrient guide, a meal manager that computes nutrient
 * contribution, a dashboard/coverage view, simple reports, an
 * admin surface, and an AI Nutrient Assistant endpoint.
 *
 * This is a working MVP, not a production system. It has no user
 * accounts or persistent database yet — meals are computed
 * statelessly from whatever the client sends. See README.md for
 * what to add before this goes live for real users.
 * ---------------------------------------------------------------
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const FOODS_PATH = path.join(__dirname, "data", "foods.json");
const NUTRIENTS_PATH = path.join(__dirname, "data", "nutrients.json");

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

let foods = loadJson(FOODS_PATH);
let nutrients = loadJson(NUTRIENTS_PATH);

const NUTRIENT_IDS = nutrients.map((n) => n.id);
const WATCH_NUTRIENTS = nutrients.filter((n) => n.watch).map((n) => n.id);

// Generic, non-personalized reference amounts used only to show a rough
// coverage indicator on the dashboard. These are NOT medical guidance —
// see the disclaimers in README.md and in the AI system prompt below.
const GENERIC_DAILY_REFERENCE = {
  protein: 50, carbohydrates: 275, fat: 78, fiber: 28,
  calcium: 1000, iron: 14, potassium: 3400, magnesium: 350, zinc: 10,
  vitaminA: 900, vitaminC: 75, vitaminD: 15, vitaminB12: 2.4,
  sodium: 2300, addedSugar: 50, water: 2500
};

function statusForNutrient(id, amount) {
  const target = GENERIC_DAILY_REFERENCE[id];
  if (!target) return "unknown";
  const ratio = amount / target;
  if (WATCH_NUTRIENTS.includes(id)) {
    if (ratio < 0.7) return "good";
    if (ratio < 1) return "moderate";
    return "high";
  }
  if (ratio >= 0.8) return "good";
  if (ratio >= 0.4) return "moderate";
  return "low";
}

function emptyTotals() {
  const totals = {};
  NUTRIENT_IDS.forEach((id) => (totals[id] = 0));
  return totals;
}

/** entries: [{ foodId, servings }] -> nutrient totals for that set */
function computeTotals(entries) {
  const totals = emptyTotals();
  const resolved = [];
  for (const entry of entries || []) {
    const food = foods.find((f) => f.id === entry.foodId);
    if (!food) {
      resolved.push({ foodId: entry.foodId, error: "unknown foodId" });
      continue;
    }
    const servings = Number(entry.servings) > 0 ? Number(entry.servings) : 1;
    NUTRIENT_IDS.forEach((id) => {
      totals[id] += (food.nutrients[id] || 0) * servings;
    });
    resolved.push({ foodId: food.id, name: food.name, servings, serving: food.serving });
  }
  Object.keys(totals).forEach((k) => (totals[k] = Math.round(totals[k] * 10) / 10));
  return { totals, resolved };
}

// ---------------------------------------------------------------
// Food Database  —  "What is in food?"
// ---------------------------------------------------------------

app.get("/api/foods", (req, res) => {
  const q = (req.query.query || "").toLowerCase().trim();
  const results = foods
    .filter((f) => !q || f.name.toLowerCase().includes(q) || f.category.toLowerCase().includes(q))
    .map(({ id, name, category, serving, keyNutrients }) => ({ id, name, category, serving, keyNutrients }));
  res.json({ results });
});

app.get("/api/foods/:id", (req, res) => {
  const food = foods.find((f) => f.id === req.params.id);
  if (!food) return res.status(404).json({ error: "Food not found." });
  res.json(food);
});

// ---------------------------------------------------------------
// Nutrient Guide  —  "What is this nutrient and why do I need it?"
// ---------------------------------------------------------------

app.get("/api/nutrients", (req, res) => {
  const category = req.query.category;
  const results = nutrients
    .filter((n) => !category || n.category === category)
    .map(({ id, name, category, unit, watch }) => ({ id, name, category, unit, watch }));
  res.json({ results });
});

app.get("/api/nutrients/:id", (req, res) => {
  const nutrient = nutrients.find((n) => n.id === req.params.id);
  if (!nutrient) return res.status(404).json({ error: "Nutrient not found." });
  // Attach the actual foods (not just ids) so the client doesn't need a second lookup.
  const sourceFoods = foods
    .filter((f) => nutrient.foodSources.includes(f.id))
    .map(({ id, name }) => ({ id, name }));
  res.json({ ...nutrient, sourceFoods });
});

// ---------------------------------------------------------------
// Meal Manager  —  "What did I eat?"
// body: { entries: [{ foodId, servings }] }
// ---------------------------------------------------------------

app.post("/api/meals/compute", (req, res) => {
  const { entries } = req.body || {};
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: "Provide at least one { foodId, servings } entry." });
  }
  const { totals, resolved } = computeTotals(entries);
  res.json({ items: resolved, totals });
});

// ---------------------------------------------------------------
// Dashboard  —  "Where am I today?"
// body: { meals: [ { name, entries: [{foodId, servings}] }, ... ] }
// (stateless MVP: client sends today's meals, server aggregates + scores)
// ---------------------------------------------------------------

app.post("/api/dashboard", (req, res) => {
  const { meals } = req.body || {};
  const allEntries = (meals || []).flatMap((m) => m.entries || []);
  const { totals } = computeTotals(allEntries);

  const coverage = NUTRIENT_IDS.map((id) => ({
    nutrient: id,
    amount: totals[id],
    unit: nutrients.find((n) => n.id === id).unit,
    status: statusForNutrient(id, totals[id]),
    watch: WATCH_NUTRIENTS.includes(id)
  }));

  const attention = coverage.filter(
    (c) => (!c.watch && c.status === "low") || (c.watch && c.status === "high")
  );

  res.json({
    mealsLogged: (meals || []).length,
    totals,
    coverage,
    nutrientsNeedingAttention: attention.map((a) => a.nutrient)
  });
});

// ---------------------------------------------------------------
// Reports  —  "How have I been doing?"
// body: { days: [ { date, meals: [{entries}] }, ... ] }
// ---------------------------------------------------------------

app.post("/api/reports", (req, res) => {
  const { days } = req.body || {};
  if (!Array.isArray(days) || days.length === 0) {
    return res.status(400).json({ error: "Provide a days array to summarize." });
  }

  const runningTotals = emptyTotals();
  const foodFrequency = {};
  let mealsLogged = 0;

  for (const day of days) {
    const entries = (day.meals || []).flatMap((m) => m.entries || []);
    mealsLogged += (day.meals || []).length;
    const { totals } = computeTotals(entries);
    NUTRIENT_IDS.forEach((id) => (runningTotals[id] += totals[id]));
    for (const entry of entries) {
      foodFrequency[entry.foodId] = (foodFrequency[entry.foodId] || 0) + 1;
    }
  }

  const dayCount = days.length;
  const averages = {};
  NUTRIENT_IDS.forEach((id) => (averages[id] = Math.round((runningTotals[id] / dayCount) * 10) / 10));

  const mostFrequentFoods = Object.entries(foodFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([foodId, count]) => ({ foodId, name: foods.find((f) => f.id === foodId)?.name || foodId, count }));

  const underCovered = NUTRIENT_IDS.filter(
    (id) => !WATCH_NUTRIENTS.includes(id) && statusForNutrient(id, averages[id]) === "low"
  );

  res.json({
    period: { days: dayCount },
    mealsLogged,
    dailyAverages: averages,
    mostFrequentFoods,
    nutrientsFrequentlyUnderCovered: underCovered
  });
});

// ---------------------------------------------------------------
// AI Nutrient Assistant
// Matches the original /api/chat contract (messages -> streamed
// plain-text answer) and optionally accepts a `context` object so
// the bot can be "aware" of the page/food/meal the user is on.
// ---------------------------------------------------------------

const SYSTEM_PROMPT = `You are the NutriScope Nutrient Assistant, embedded in a food and nutrition management website.

Scope: everyday foods and the nutrients people commonly need to pay attention to (protein, carbohydrates, fat, fiber, calcium, iron, potassium, magnesium, zinc, vitamin A, vitamin C, vitamin D, vitamin B12, sodium, added sugar, water). Include common Indian foods (dal, roti, rice, paneer, ragi, curd, etc.) alongside general foods.

Rules:
- Educational only. Never provide medical advice, diagnoses, or personalized medical/dietary prescriptions. If asked something medical, suggest the person speak with a doctor or registered dietitian.
- Distinguish nutrients people should generally get enough of from ones to watch/limit (sodium, added sugar).
- Keep answers concise, practical, and specific to what was asked. Use the structured food/nutrient/meal data given in context when present, and don't invent numbers that contradict it.
- Never tell someone to change their body size or prescribe a restrictive diet. Focus on nutritional adequacy and informed choices.`;

app.post("/api/chat", async (req, res) => {
  const { messages, context } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "No messages provided." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "AI is not configured." });
  }

  const trimmed = messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
  const contextNote = context
    ? `\n\nCurrent page context (for reference, not to be read aloud verbatim): ${JSON.stringify(context)}`
    : "";

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 1000,
        system: SYSTEM_PROMPT + contextNote,
        messages: trimmed,
        stream: true
      })
    });

    if (upstream.status === 429) {
      const retryAfter = upstream.headers.get("retry-after");
      if (retryAfter) res.set("Retry-After", retryAfter);
      return res.status(429).json({ error: "The nutrient bot is busy right now. Please try again in a moment." });
    }
    if (upstream.status === 402 || upstream.status === 403) {
      return res.status(402).json({ error: "AI credits have run out for this workspace." });
    }
    if (!upstream.ok) {
      return res.status(500).json({ error: "The nutrient bot could not answer right now." });
    }

    res.set("Content-Type", "text/plain; charset=utf-8");
    res.set("Cache-Control", "no-cache");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload);
          if (event.type === "content_block_delta" && event.delta?.text) {
            res.write(event.delta.text);
          }
        } catch (_) {
          // ignore malformed/partial SSE chunks
        }
      }
    }
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: "The nutrient bot could not answer right now." });
    } else {
      res.end();
    }
  }
});

// ---------------------------------------------------------------
// Admin  —  add/update/delete foods & nutrients
// Protected by a single shared key in the x-admin-key header, set
// via the ADMIN_KEY env var. Replace with real auth before going live.
// ---------------------------------------------------------------

function requireAdmin(req, res, next) {
  const key = process.env.ADMIN_KEY;
  if (!key) return res.status(500).json({ error: "Admin access is not configured." });
  if (req.get("x-admin-key") !== key) return res.status(401).json({ error: "Invalid admin key." });
  next();
}

app.post("/api/admin/foods", requireAdmin, (req, res) => {
  const food = req.body;
  if (!food?.id || !food?.name || !food?.nutrients) {
    return res.status(400).json({ error: "food requires at least id, name, and nutrients." });
  }
  foods = foods.filter((f) => f.id !== food.id);
  foods.push(food);
  saveJson(FOODS_PATH, foods);
  res.status(201).json(food);
});

app.delete("/api/admin/foods/:id", requireAdmin, (req, res) => {
  foods = foods.filter((f) => f.id !== req.params.id);
  saveJson(FOODS_PATH, foods);
  res.status(204).end();
});

app.post("/api/admin/nutrients", requireAdmin, (req, res) => {
  const nutrient = req.body;
  if (!nutrient?.id || !nutrient?.name) {
    return res.status(400).json({ error: "nutrient requires at least id and name." });
  }
  nutrients = nutrients.filter((n) => n.id !== nutrient.id);
  nutrients.push(nutrient);
  saveJson(NUTRIENTS_PATH, nutrients);
  res.status(201).json(nutrient);
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NutriScope backend listening on port ${PORT}`));
