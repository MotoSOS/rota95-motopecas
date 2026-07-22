module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      error: "Supabase não configurado na Vercel.",
      missing: {
        SUPABASE_URL: !supabaseUrl,
        SUPABASE_ANON_KEY: !supabaseAnonKey
      }
    });
  }

  return res.status(200).json({
    supabaseUrl,
    supabaseAnonKey
  });
};
