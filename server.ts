import express from "express";
import path from "path";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Prevent crash if variables are missing, but log the error
if (!supabaseUrl || !supabaseServiceKey) {
  console.error("ERRO CRÍTICO: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas!");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const app = express();
app.use(express.json());

// Middleware para logar todas as requisições (ajuda no debug da Vercel)
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// --- API ROUTES ---

// Users
app.get("/api/users", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select(`
        *,
        match_count:match_players(count),
        rating_count:ratings!ratings_rated_id_fkey(count)
      `)
      .order("level", { ascending: false, nullsFirst: false });

    if (error) throw error;

    const transformed = data.map(u => ({
      ...u,
      match_count: u.match_count?.[0]?.count || 0,
      rating_count: u.rating_count?.[0]?.count || 0
    }));

    res.json(transformed);
  } catch (e) {
    res.status(500).json({ error: "Erro ao buscar usuários" });
  }
});

app.get("/api/users/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select(`
        *,
        match_count:match_players(count),
        rating_count:ratings!ratings_rated_id_fkey(count)
      `)
      .eq("id", req.params.id)
      .single();

    if (error) throw error;

    const transformed = {
      ...data,
      match_count: data.match_count?.[0]?.count || 0,
      rating_count: data.rating_count?.[0]?.count || 0
    };

    res.json(transformed);
  } catch (e) {
    res.status(404).json({ error: "Usuário não encontrado" });
  }
});

app.post("/api/users", async (req, res) => {
  const { id, name, username, nickname, position, photo_url, password } = req.body;
  
  if (!username || username.length < 4) return res.status(400).json({ error: "O nome de usuário deve ter no mínimo 4 caracteres." });
  if (!password || password.length < 4) return res.status(400).json({ error: "A senha deve ter no mínimo 4 caracteres." });

  try {
    console.log("Tentando criar usuário:", username);
    const hashedPassword = await bcrypt.hash(password, 10);
    const { count, error: countError } = await supabase.from("users").select("*", { count: 'exact', head: true });
    
    if (countError) {
      console.error("Erro ao contar usuários no Supabase:", countError);
      throw countError;
    }

    const role = (count === 0) ? 'manager' : 'player';

    const { data, error } = await supabase
      .from("users")
      .insert([{ id, name, username, nickname, position, photo_url, password: hashedPassword, role }])
      .select()
      .single();

    if (error) {
      console.error("Erro ao inserir usuário no Supabase:", error);
      throw error;
    }
    
    console.log("Usuário criado com sucesso!");
    res.status(201).json({ ...data, match_count: 0, rating_count: 0 });
  } catch (e: any) {
    console.error("Erro interno no servidor (POST /api/users):", e);
    res.status(500).json({ error: "Erro interno no servidor", details: e.message || String(e) });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const { data: user, error } = await supabase
      .from("users")
      .select(`
        *,
        match_count:match_players(count),
        rating_count:ratings!ratings_rated_id_fkey(count)
      `)
      .eq("username", username)
      .single();

    if (error || !user) return res.status(401).json({ error: "Usuário não encontrado" });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: "Senha incorreta" });

    const { password: _, ...userWithoutPassword } = user;
    const transformed = {
      ...userWithoutPassword,
      match_count: user.match_count?.[0]?.count || 0,
      rating_count: user.rating_count?.[0]?.count || 0
    };
    res.json(transformed);
  } catch (e) {
    res.status(500).json({ error: "Erro no servidor" });
  }
});

app.delete("/api/users/:id", async (req, res) => {
  const managerId = req.headers["x-manager-id"] as string;
  const { data: manager } = await supabase.from("users").select("role").eq("id", managerId).single();
  if (!manager || manager.role !== 'manager') return res.status(403).json({ error: "Apenas gestores podem remover jogadores." });

  try {
    await supabase.from("users").delete().eq("id", req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Erro ao remover usuário" });
  }
});

// Matches
app.get("/api/matches", async (req, res) => {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .order("date", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/matches", async (req, res) => {
  const { id, date, time, location, max_players, userId } = req.body;
  const { data: user } = await supabase.from("users").select("role").eq("id", userId).single();
  if (!user || user.role !== 'manager') return res.status(403).json({ error: "Apenas gestores podem criar peladas." });

  const { data, error } = await supabase
    .from("matches")
    .insert([{ id, date, time, location, max_players, created_by: userId }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

app.get("/api/matches/:id/players", async (req, res) => {
  const { data, error } = await supabase
    .from("match_players")
    .select(`status, user:users(id, name, username, nickname, position, level, photo_url)`)
    .eq("match_id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(mp => ({ ...(mp.user as any), match_status: mp.status })));
});

app.post("/api/matches/:id/finish", async (req, res) => {
  const { error } = await supabase.from("matches").update({ status: 'finished' }).eq("id", req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

app.post("/api/matches/:id/join", async (req, res) => {
  const { userId } = req.body;
  const matchId = req.params.id;
  const { data: match } = await supabase.from("matches").select("max_players, created_by").eq("id", matchId).single();
  if (!match) return res.status(404).json({ error: "Match not found" });

  const { data: isAuthorized } = await supabase
    .from("manager_authorizations")
    .select("*")
    .eq("manager_id", match.created_by)
    .eq("user_id", userId)
    .single();

  if (isAuthorized) {
    const { count } = await supabase.from("match_players").select("*", { count: 'exact', head: true }).eq("match_id", matchId).eq("status", "confirmed");
    const status = (count || 0) < match.max_players ? 'confirmed' : 'reserve';
    await supabase.from("match_players").insert([{ match_id: matchId, user_id: userId, status }]);
    res.json({ status, authorized: true });
  } else {
    await supabase.from("match_players").insert([{ match_id: matchId, user_id: userId, status: 'pending' }]);
    res.json({ status: 'pending', authorized: false });
  }
});

// Manager Endpoints
app.get("/api/manager/:id/requests", async (req, res) => {
  const { data, error } = await supabase
    .from("match_players")
    .select(`match_id, user_id, status, user:users(name, nickname, photo_url, position, level), match:matches(location, date, time, created_by)`)
    .eq("status", "pending");

  if (error) return res.status(500).json({ error: error.message });
  res.json(data.filter((mp: any) => mp.match.created_by === req.params.id).map((mp: any) => ({
    ...mp.user, ...mp.match, match_id: mp.match_id, user_id: mp.user_id
  })));
});

app.post("/api/manager/:id/approve", async (req, res) => {
  const { userId, matchId } = req.body;
  try {
    await supabase.from("manager_authorizations").upsert([{ manager_id: req.params.id, user_id: userId }]);
    const { data: match } = await supabase.from("matches").select("max_players").eq("id", matchId).single();
    const { count } = await supabase.from("match_players").select("*", { count: 'exact', head: true }).eq("match_id", matchId).eq("status", "confirmed");
    const status = (count || 0) < (match?.max_players || 12) ? 'confirmed' : 'reserve';
    await supabase.from("match_players").update({ status }).eq("match_id", matchId).eq("user_id", userId);
    res.json({ success: true, status });
  } catch (e) {
    res.status(500).json({ error: "Erro ao aprovar" });
  }
});

app.post("/api/manager/:id/reject", async (req, res) => {
  await supabase.from("match_players").delete().eq("match_id", req.body.matchId).eq("user_id", req.body.userId).eq("status", "pending");
  res.json({ success: true });
});

// Ratings
app.post("/api/ratings", async (req, res) => {
  const { id, match_id, rater_id, rated_id, score, comment, is_anonymous } = req.body;
  const { data: rater } = await supabase.from("users").select("role").eq("id", rater_id).single();
  if (!rater || (rater.role !== 'scout' && rater.role !== 'manager')) return res.status(403).json({ error: "Não autorizado" });

  const { error } = await supabase.from("ratings").insert([{ id, match_id, rater_id, rated_id, score, comment, is_anonymous }]);
  if (error) return res.status(400).json({ error: error.message });
  
  const { data: ratings } = await supabase.from("ratings").select("score").eq("rated_id", rated_id);
  if (ratings?.length) {
    const avg = ratings.reduce((acc, curr) => acc + curr.score, 0) / ratings.length;
    await supabase.from("users").update({ level: avg }).eq("id", rated_id);
  }
  res.status(201).json({ success: true });
});

app.get("/api/rankings", async (req, res) => {
  const { data, error } = await supabase.from("users").select("*").order("level", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// --- VITE / STATIC FILES ---

if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  // Use dynamic import for Vite only in development
  import("vite").then(({ createServer: createViteServer }) => {
    createViteServer({ server: { middlewareMode: true }, appType: "spa" }).then(vite => {
      app.use(vite.middlewares);
      app.listen(3000, "0.0.0.0", () => console.log("Dev server running on port 3000"));
    });
  });
} else {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) return; // Don't serve index.html for API calls
    res.sendFile(path.join(distPath, "index.html"));
  });
}

export default app;
