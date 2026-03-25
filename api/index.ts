import express from "express";
import path from "path";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("⚠️ ERRO DE CONFIGURAÇÃO: As variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não foram encontradas no ambiente.");
  console.log("👉 Para corrigir: Vá em Settings (ícone de engrenagem) > Environment Variables e adicione as chaves do Supabase.");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const app = express();
app.use(express.json());

// Log de requisições para debug
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// --- ROTAS DA API ---

app.get("/api/users", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select(`*, match_count:match_players(count), rating_count:ratings!ratings_rated_id_fkey(count)`)
      .order("level", { ascending: false, nullsFirst: false });
    if (error) throw error;
    res.json(data.map(u => ({
      ...u,
      match_count: u.match_count?.[0]?.count || 0,
      rating_count: u.rating_count?.[0]?.count || 0
    })));
  } catch (e) {
    res.status(500).json({ error: "Erro ao buscar usuários" });
  }
});

app.post("/api/users", async (req, res) => {
  const { id, name, username, nickname, position, photo_url, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const { count } = await supabase.from("users").select("*", { count: 'exact', head: true });
    const role = (count === 0) ? 'manager' : 'player';
    const { data, error } = await supabase
      .from("users")
      .insert([{ id, name, username, nickname, position, photo_url, password: hashedPassword, role }])
      .select().single();
    if (error) throw error;
    res.status(201).json({ ...data, match_count: 0, rating_count: 0 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const { data: user, error } = await supabase.from("users").select(`*, match_count:match_players(count), rating_count:ratings!ratings_rated_id_fkey(count)`).eq("username", username).single();
    if (error || !user) return res.status(401).json({ error: "Usuário não encontrado" });
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: "Senha incorreta" });
    const { password: _, ...userWithoutPassword } = user;
    res.json({ ...userWithoutPassword, match_count: user.match_count?.[0]?.count || 0, rating_count: user.rating_count?.[0]?.count || 0 });
  } catch (e) {
    res.status(500).json({ error: "Erro no servidor" });
  }
});

// Rotas de Peladas (Matches)
app.get("/api/matches", async (req, res) => {
  const { data, error } = await supabase.from("matches").select("*").order("date", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/matches", async (req, res) => {
  const { id, date, time, location, max_players, userId } = req.body;
  const { data, error } = await supabase.from("matches").insert([{ id, date, time, location, max_players, created_by: userId }]).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

app.get("/api/matches/:id/players", async (req, res) => {
  const { data, error } = await supabase.from("match_players").select(`status, user:users(id, name, username, nickname, position, level, photo_url)`).eq("match_id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(mp => ({ ...(mp.user as any), match_status: mp.status })));
});

app.post("/api/matches/:id/join", async (req, res) => {
  const { userId } = req.body;
  const { data: match } = await supabase.from("matches").select("max_players, created_by").eq("id", req.params.id).single();
  if (!match) return res.status(404).json({ error: "Pelada não encontrada" });
  const { count } = await supabase.from("match_players").select("*", { count: 'exact', head: true }).eq("match_id", req.params.id).eq("status", "confirmed");
  const status = (count || 0) < match.max_players ? 'confirmed' : 'reserve';
  const { error } = await supabase.from("match_players").insert([{ match_id: req.params.id, user_id: userId, status }]);
  if (error) return res.status(400).json({ error: "Já está inscrito" });
  res.json({ status });
});

// --- ROTAS DO GESTOR ---

app.get("/api/manager/:id/requests", async (req, res) => {
  const { data, error } = await supabase
    .from("match_players")
    .select(`
      match_id, 
      user_id, 
      status, 
      matches(location, date, time), 
      users(nickname, photo_url)
    `)
    .eq("status", "pending");
  
  if (error) return res.status(500).json({ error: error.message });
  
  res.json(data.map((req: any) => ({
    match_id: req.match_id,
    user_id: req.user_id,
    status: req.status,
    location: req.matches.location,
    date: req.matches.date,
    time: req.matches.time,
    nickname: req.users.nickname,
    photo_url: req.users.photo_url
  })));
});

app.post("/api/manager/:id/approve", async (req, res) => {
  const { userId, matchId } = req.body;
  const { error } = await supabase
    .from("match_players")
    .update({ status: 'confirmed' })
    .eq("match_id", matchId)
    .eq("user_id", userId);
  
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

app.post("/api/manager/:id/reject", async (req, res) => {
  const { userId, matchId } = req.body;
  const { error } = await supabase
    .from("match_players")
    .delete()
    .eq("match_id", matchId)
    .eq("user_id", userId);
  
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

app.post("/api/manager/:id/update-role", async (req, res) => {
  const { userId, role } = req.body;
  const { error } = await supabase
    .from("users")
    .update({ role })
    .eq("id", userId);
  
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

app.delete("/api/users/:id", async (req, res) => {
  const managerId = req.headers["x-manager-id"];
  if (!managerId) return res.status(401).json({ error: "Não autorizado" });

  // Verify if requester is manager
  const { data: manager } = await supabase.from("users").select("role").eq("id", managerId).single();
  if (!manager || manager.role !== 'manager') return res.status(403).json({ error: "Apenas gestores podem excluir usuários" });

  const { error } = await supabase.from("users").delete().eq("id", req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// --- CONFIGURAÇÃO DE AMBIENTE ---

if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  // Desenvolvimento local (AI Studio)
  import("vite").then(({ createServer }) => {
    createServer({ server: { middlewareMode: true }, appType: "spa" }).then(vite => {
      app.use(vite.middlewares);
      app.listen(3000, "0.0.0.0", () => console.log("Servidor local rodando na porta 3000"));
    });
  });
} else {
  // Produção (Vercel)
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) return;
    res.sendFile(path.join(distPath, "index.html"));
  });
}

export default app;
