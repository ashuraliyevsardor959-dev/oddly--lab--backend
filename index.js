
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

app.get("/", (req, res) => {
  res.json({
    success: true,
    app: "Oddly Satisfying Lab",
    message: "Backend server ishlayapti!",
    version: "1.0.0"
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    status: "online",
    currency: "USD"
  });
});

app.get("/api/db-check", async (req, res) => {
  try {
    const { error } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });

    if (error) {
      console.error("Supabase xatosi:", error);
      return res.status(500).json({
        success: false,
        database: "connection failed"
      });
    }

    res.json({
      success: true,
      database: "connected"
    });
  } catch (error) {
    console.error("Server xatosi:", error.message);
    res.status(500).json({
      success: false,
      database: "connection failed"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Oddly Lab server: http://localhost:${PORT}`);
});
function verifyTelegramInitData(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) return null;

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(calculatedHash, "hex");

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  const authDate = Number(params.get("auth_date"));

  if (!authDate || Date.now() / 1000 - authDate > 86400) {
    return null;
  }

  try {
    return JSON.parse(params.get("user"));
  } catch {
    return null;
  }
}

app.post("/api/telegram-auth", async (req, res) => {
  try {
    const user = verifyTelegramInitData(req.body.initData || "");

    if (!user || !user.id) {
      return res.status(401).json({
        success: false,
        message: "Telegram tekshiruvi muvaffaqiyatsiz"
      });
    }

    const telegramId = String(user.id);

    let { data: profile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (error) throw error;

    if (!profile) {
      const result = await supabase
        .from("profiles")
        .insert({
          telegram_id: telegramId,
          username: user.username || null,
          full_name: [user.first_name, user.last_name]
            .filter(Boolean)
            .join(" "),
          balance: 0
        })
        .select("*")
        .single();

      if (result.error) throw result.error;
      profile = result.data;
    }

    res.json({
  success: true,
  user: {
    telegram_id: profile.telegram_id,
    username: profile.username,
    full_name: profile.full_name,
    balance: profile.balance,
    photo_url: user.photo_url || null
  }
});
  } catch (error) {
    console.error("Telegram auth xatosi:", error.message);
    res.status(500).json({
      success: false,
      message: "Server xatosi"
    });
  }
});
