




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

    const { data, error } = await supabase.rpc(
      "restore_watch_session",
      { p_telegram_id: user.id }
    );

    if (error) throw error;

    res.json(data);
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
      .select("id, accumulated_seconds")
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
        accumulated_seconds: active.accumulated_seconds,
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
async function checkReferralBonus(telegramId) {
  try {
    const { data, error } = await supabase.rpc("award_referral_bonus", {
      p_telegram_id: telegramId
    });
    if (error) throw error;
    if (data?.success) console.log("REFERRAL BONUS AWARDED:", telegramId);
  } catch (error) {
    console.error("Referral bonus check:", error.message);
  }
}

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
    await checkReferralBonus(user.id);

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
    console.log("WATCH STOP CALLED:", new Date().toISOString(), "SESSION:", sessionId);

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
    await checkReferralBonus(user.id);

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

app.post("/api/withdraw", async (req, res) => {
  try {
    const user = verifyTelegramInitData(req.body.initData || "");
    const method = String(req.body.payment_method || "");
    const wallet = String(req.body.wallet_address || "").trim();
    const amount = Number(req.body.amount);

    const allowedMethods = ["USDT TRC20", "USDT BEP20", "TON", "HUMO", "Uzcard"];

    if (!user || !user.id) {
      return res.status(401).json({
        success: false,
        message: "Telegram authentication failed"
      });
    }

    if (!allowedMethods.includes(method)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method"
      });
    }

    if (method === "HUMO" || method === "Uzcard") {
      if (!/^\\d{16}$/.test(wallet)) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid 16-digit card number"
        });
      }
    } else if (wallet.length < 5 || wallet.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid wallet address"
      });
    }

    if (!Number.isFinite(amount) || amount < 50) {
      return res.status(400).json({
        success: false,
        message: "Minimum withdrawal amount is $50"
      });
    }

    const { data, error } = await supabase.rpc("request_withdrawal", {
      p_telegram_id: user.id,
      p_payment_method: method,
      p_wallet_address: wallet,
      p_amount: amount
    });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error("Withdraw error:", error.message);
    res.status(400).json({ success: false, message: error.message });
  }
});


app.post("/api/admin/withdrawals", async (req, res) => {
  try {
    const user = verifyTelegramInitData(req.body.initData || "");

    if (!user || String(user.id) !== String(process.env.ADMIN_TELEGRAM_ID)) {
      return res.status(403).json({ success: false, message: "Admin access denied" });
    }

    const { data, error } = await supabase
      .from("withdrawals")
      .select("id,telegram_id,payment_method,wallet_address,amount,status,created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    return res.json({ success: true, withdrawals: data || [] });
  } catch (error) {
    console.error("Admin withdrawals:", error.message);
    return res.status(500).json({ success: false, message: "Could not load withdrawals" });
  }
});

app.post("/api/admin/withdrawal-update", async (req, res) => {
  try {
    const user = verifyTelegramInitData(req.body.initData || "");

    if (!user || String(user.id) !== String(process.env.ADMIN_TELEGRAM_ID)) {
      return res.status(403).json({ success: false, message: "Admin access denied" });
    }

    const withdrawalId = Number(req.body.withdrawal_id);
    const status = String(req.body.status || "");

    if (!Number.isSafeInteger(withdrawalId) || withdrawalId <= 0 ||
        !["completed", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid request" });
    }

    const { data, error } = await supabase.rpc("admin_update_withdrawal", {
      p_withdrawal_id: withdrawalId,
      p_status: status
    });

    if (error) throw error;

    return res.json(data);
  } catch (error) {
    console.error("Admin withdrawal update:", error.message);
    return res.status(400).json({ success: false, message: error.message });
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
    const signedParams = new URLSearchParams(req.body.initData || "");
    const startParam = signedParams.get("start_param") || "";
    const referralMatch = startParam.match(/^ref_(\d{5,20})$/);
    let referrerId = null;

    if (referralMatch && referralMatch[1] !== telegramId) {
      const { data: referrer, error: refError } = await supabase
        .from("profiles")
        .select("telegram_id")
        .eq("telegram_id", referralMatch[1])
        .maybeSingle();

      if (refError) throw refError;
      if (referrer) referrerId = referrer.telegram_id;
    }

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
          balance: 0,
          referred_by: referrerId
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
    referral_earnings: profile.referral_earnings || 0,
    referral_count: profile.referral_count || 0,
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
