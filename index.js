




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
app.post("/api/watch-active", async (req, res) => {
  try {
    const user = verifyTelegramInitData(req.body.initData || "");

    if (!user || !user.id) {
      return res.status(401).json({ success: false });
    }

    const { data: active, error: findError } = await supabase
      .from("watch_sessions")
      .select("id")
      .eq("telegram_id", user.id)
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;

    if (!active) {
      return res.json({ success: true, session: null });
    }

    const { data, error } = await supabase
      .from("watch_sessions")
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq("id", active.id)
      .eq("telegram_id", user.id)
      .eq("status", "active")
      .select("id, started_at, last_heartbeat_at, accumulated_seconds")
      .maybeSingle();

    if (error) throw error;

    res.json({
      success: true,
      session: data
    });
  } catch (error) {
    console.error("Watch active:", error.message);
    res.status(500).json({ success: false });
  }
});
app.post("/api/watch-start", async (req, res) => {
  try {
    const user = verifyTelegramInitData(req.body.initData || "");

    if (!user || !user.id) {
      return res.status(401).json({ success: false });
    }

    const { data: active, error: findError } = await supabase
      .from("watch_sessions")
      .select("id")
      .eq("telegram_id", user.id)
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;

    if (active) {
      return res.json({
        success: true,
        session_id: active.id,
        restored: true
      });
    }

    const { data, error } = await supabase
      .from("watch_sessions")
      .insert({
        telegram_id: user.id,
        status: "active"
      })
      .select("id")
      .single();

    if (error) throw error;

    res.json({
      success: true,
      session_id: data.id,
      restored: false
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ success: false });
  }
});
app.post("/api/watch-heartbeat", async (req, res) => {
  try {
    const user = verifyTelegramInitData(req.body.initData || "");
    const sessionId = req.body.session_id;

    if (!user || !user.id || !sessionId) {
      return res.status(401).json({ success: false });
    }

    const { data, error } = await supabase.rpc(
      "add_watch_earning",
      {
        p_session_id: sessionId,
        p_telegram_id: user.id
      }
    );

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error("Watch heartbeat:", error.message);
    res.status(500).json({ success: false });
  }
});

app.post("/api/watch-stop", async (req, res) => {
  try {
    const user = verifyTelegramInitData(req.body.initData || "");
    const sessionId = req.body.session_id;

    if (!user || !user.id || !sessionId) {
      return res.status(401).json({ success: false });
    }

    const { data, error } = await supabase.rpc(
      "stop_watch_session",
      {
        p_session_id: sessionId,
        p_telegram_id: user.id
      }
    );

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error("Watch stop:", error.message);
    res.status(500).json({ success: false });
  }
});
app.post("/api/transactions", async (req, res) => {
  try {
    const user = verifyTelegramInitData(req.body.initData || "");

    if (!user || !user.id) {
      return res.status(401).json({ success: false });
    }

    const { data, error } = await supabase
      .from("transactions")
      .select("id, type, amount, status, created_at")
      .eq("telegram_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({
      success: true,
      transactions: data || []
    });
  } catch (error) {
    console.error("Transactions:", error.message);
    res.status(500).json({ success: false });
  }
});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Oddly Lab server: http://localhost:${PORT}`);
});
function verifyTelegramInitData(initData) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken || typeof initData !== "string" || !initData || initData.length > 10000) {
      return null;
    }

    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
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
    const now = Math.floor(Date.now() / 1000);

    if (!Number.isFinite(authDate) || authDate <= 0 ||
        authDate > now + 60 || now - authDate > 86400) {
      return null;
    }

    const user = JSON.parse(params.get("user") || "null");

    if (!user || !user.id) return null;

    return user;
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
