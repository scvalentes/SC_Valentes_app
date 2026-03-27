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

// One-time migration to assign registration numbers to existing users
async function migrateRegistrationNumbers() {
  const { data: users, error } = await supabase
    .from("users")
    .select("id, registration_number, created_at")
    .order("created_at", { ascending: true });
  
  if (error || !users) return;

  for (let i = 0; i < users.length; i++) {
    if (!users[i].registration_number) {
      await supabase
        .from("users")
        .update({ registration_number: i + 1 })
        .eq("id", users[i].id);
    }
  }
}

migrateRegistrationNumbers();

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
    const { data: usersData, error: usersError } = await supabase
      .from("users")
      .select(`*, rating_count:ratings!ratings_rated_id_fkey(count)`)
      .order("level", { ascending: false, nullsFirst: false });
    
    if (usersError) throw usersError;

    // Fetch counts of finished matches for each user
    const { data: matchCounts, error: countsError } = await supabase
      .from("match_players")
      .select(`user_id, matches!inner(status)`)
      .eq("matches.status", "finished");

    if (countsError) throw countsError;

    const countsMap: Record<string, number> = {};
    matchCounts?.forEach((mc: any) => {
      countsMap[mc.user_id] = (countsMap[mc.user_id] || 0) + 1;
    });

    res.json(usersData.map(u => ({
      ...u,
      match_count: countsMap[u.id] || 0,
      rating_count: u.rating_count?.[0]?.count || 0,
      goals: u.goals || 0,
      assists: u.assists || 0,
      wins: u.wins || 0,
      registration_number: u.registration_number
    })));
  } catch (e) {
    res.status(500).json({ error: "Erro ao buscar usuários" });
  }
});

app.post("/api/users", async (req, res) => {
  const { id, name, username, nickname, position, photo_url, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Get the highest registration number to ensure uniqueness and order
    const { data: lastUser } = await supabase
      .from("users")
      .select("registration_number")
      .order("registration_number", { ascending: false })
      .limit(1);
    
    const lastNum = lastUser && lastUser.length > 0 ? lastUser[0].registration_number : 0;
    const registration_number = lastNum + 1;
    
    // Determine role (first user is manager)
    const { count } = await supabase.from("users").select("*", { count: 'exact', head: true });
    const role = (count === 0) ? 'manager' : 'player';

    const { data, error } = await supabase
      .from("users")
      .insert([{ id, name, username, nickname, position, photo_url, password: hashedPassword, role, registration_number }])
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
    const { data: user, error } = await supabase
      .from("users")
      .select(`*, rating_count:ratings!ratings_rated_id_fkey(count)`)
      .eq("username", username)
      .single();
    
    if (error || !user) return res.status(401).json({ error: "Usuário não encontrado" });
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: "Senha incorreta" });

    // Fetch match count for finished matches
    const { count } = await supabase
      .from("match_players")
      .select("match_id, matches!inner(status)", { count: 'exact', head: true })
      .eq("user_id", user.id)
      .eq("matches.status", "finished");

    const { password: _, ...userWithoutPassword } = user;
    res.json({ 
      ...userWithoutPassword, 
      match_count: count || 0, 
      rating_count: user.rating_count?.[0]?.count || 0,
      goals: user.goals || 0,
      assists: user.assists || 0,
      wins: user.wins || 0
    });
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

app.post("/api/matches/:id/finish", async (req, res) => {
  try {
    const { error } = await supabase
      .from("matches")
      .update({ status: 'finished' })
      .eq("id", req.params.id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/matches/:id", async (req, res) => {
  try {
    // Delete from all tables that might have foreign keys
    await supabase.from("ratings").delete().eq("match_id", req.params.id);
    await supabase.from("match_players").delete().eq("match_id", req.params.id);
    const { error } = await supabase.from("matches").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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

// --- ROTAS DE AVALIAÇÃO ---

app.get("/api/evaluation/players", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("match_players")
      .select(`user:users(id, name, username, nickname, position, level, photo_url)`)
      .eq("match_id", "evaluation_session");
    
    if (error) throw error;
    res.json(data.map(mp => mp.user));
  } catch (e) {
    res.status(500).json({ error: "Erro ao buscar jogadores em avaliação" });
  }
});

app.post("/api/evaluation/start", async (req, res) => {
  const { userIds } = req.body;
  try {
    // 1. Ensure the special match exists
    const { data: match } = await supabase
      .from("matches")
      .select("id")
      .eq("id", "evaluation_session")
      .single();
    
    if (!match) {
      await supabase.from("matches").insert([{
        id: "evaluation_session",
        location: "Sessão de Avaliação",
        date: new Date().toISOString().split('T')[0],
        time: "00:00",
        max_players: 100,
        status: "open",
        created_by: "system"
      }]);
    }

    // 2. Clear existing players
    await supabase.from("match_players").delete().eq("match_id", "evaluation_session");

    // 3. Add new players
    if (userIds && userIds.length > 0) {
      const inserts = userIds.map((uid: string) => ({
        match_id: "evaluation_session",
        user_id: uid,
        status: "confirmed"
      }));
      await supabase.from("match_players").insert(inserts);
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/evaluation/finish", async (req, res) => {
  try {
    await supabase.from("match_players").delete().eq("match_id", "evaluation_session");
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/stats/update", async (req, res) => {
  const { userId, type, increment } = req.body; // type: 'goals' | 'assists'
  try {
    const { data: user } = await supabase.from("users").select(type).eq("id", userId).single();
    const newValue = (user?.[type] || 0) + increment;
    const { error } = await supabase.from("users").update({ [type]: newValue }).eq("id", userId);
    if (error) throw error;
    res.json({ success: true, newValue });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/stats/winner", async (req, res) => {
  const { userIds } = req.body;
  try {
    for (const uid of userIds) {
      const { data: user } = await supabase.from("users").select("wins").eq("id", uid).single();
      const newWins = (user?.wins || 0) + 1;
      await supabase.from("users").update({ wins: newWins }).eq("id", uid);
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ratings", async (req, res) => {
  const { id, match_id, rater_id, rated_id, score, comment, is_anonymous } = req.body;
  try {
    const { error } = await supabase.from("ratings").insert([{
      id,
      match_id,
      rater_id,
      rated_id,
      score,
      comment,
      is_anonymous
    }]);
    
    if (error) throw error;

    // Update user average level
    const { data: ratings } = await supabase.from("ratings").select("score").eq("rated_id", rated_id);
    if (ratings && ratings.length > 0) {
      const avg = ratings.reduce((acc, curr) => acc + curr.score, 0) / ratings.length;
      await supabase.from("users").update({ level: avg }).eq("id", rated_id);
    }

    res.status(201).json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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
