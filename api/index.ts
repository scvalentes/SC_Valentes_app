import express from "express";
import path from "path";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
// Tenta usar Service Role Key primeiro, depois Anon Key como fallback
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("⚠️ ERRO DE CONFIGURAÇÃO: As variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY não foram encontradas no ambiente.");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// One-time migration to assign registration numbers to existing users
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
    const sortBy = req.query.sort === 'level' ? 'level' : 'created_at';
    const { data: usersData, error: usersError } = await supabase
      .from("users")
      .select(`*, rating_count:ratings!ratings_rated_id_fkey(count)`)
      .order(sortBy, { ascending: sortBy === 'created_at', nullsFirst: false });
    
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
      wins: u.wins || 0
    })));
  } catch (e) {
    res.status(500).json({ error: "Erro ao buscar usuários" });
  }
});

app.post("/api/users", async (req, res) => {
  const { id, name, username, nickname, position, photo_url, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Determine role (first user is manager)
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

app.post("/api/admin/reset-ratings", async (req, res) => {
  try {
    // Delete all ratings
    const { error: deleteError } = await supabase.from("ratings").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (deleteError) throw deleteError;

    // Reset all user levels
    const { error: updateError } = await supabase.from("users").update({ level: null }).neq("id", "00000000-0000-0000-0000-000000000000");
    if (updateError) throw updateError;

    res.json({ success: true, message: "Todas as notas foram limpas e os níveis resetados." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

const EVALUATION_SESSION_ID = "11111111-1111-1111-1111-111111111111";

// --- ROTAS DE AVALIAÇÃO ---

app.get("/api/evaluation/players", async (req, res) => {
  try {
    const raterId = req.query.raterId as string;
    console.log(`Fetching evaluation players for session ${EVALUATION_SESSION_ID}...`);
    const { data, error } = await supabase
      .from("match_players")
      .select(`user:users(id, name, username, nickname, position, level, photo_url)`)
      .eq("match_id", EVALUATION_SESSION_ID);
    
    if (error) {
      console.error("Error fetching evaluation players from Supabase:", error);
      throw error;
    }
    
    let players = data ? data.map(mp => mp.user).filter(u => u !== null) : [];
    
    // If raterId is provided, check which players have already been rated by this user in this session
    if (raterId) {
      const { data: myRatings } = await supabase
        .from("ratings")
        .select("rated_id, score")
        .eq("match_id", EVALUATION_SESSION_ID)
        .eq("rater_id", raterId);
      
      const ratingMap = new Map(myRatings?.map(r => [r.rated_id, r.score]) || []);
      players = players.map((p: any) => ({
        ...p,
        already_rated: ratingMap.has(p.id),
        my_rating: ratingMap.get(p.id) || null
      }));
    }

    console.log(`Found ${players.length} players for evaluation session`);
    res.json(players);
  } catch (e: any) {
    console.error("Server error in /api/evaluation/players:", e);
    res.status(500).json({ error: "Erro ao buscar jogadores em avaliação" });
  }
});

app.post("/api/evaluation/start", async (req, res) => {
  const { userIds, userId } = req.body;
  console.log("Starting evaluation for users:", userIds, "by manager:", userId);
  try {
    // 1. Ensure the special match exists
    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select("id")
      .eq("id", EVALUATION_SESSION_ID)
      .maybeSingle();
    
    if (matchError) {
      console.error("Error checking evaluation session match:", matchError);
    }
    
    if (!match) {
      console.log("Creating evaluation session match with UUID...");
      const { error: insertError } = await supabase.from("matches").insert([{
        id: EVALUATION_SESSION_ID,
        location: "Sessão de Avaliação",
        date: new Date().toISOString().split('T')[0],
        time: "00:00",
        max_players: 100,
        status: "open",
        created_by: userId || userIds[0] // Use a valid UUID
      }]);
      if (insertError) {
        console.error("Error inserting evaluation session match:", insertError);
        throw insertError;
      }
    }

    // 2. Clear existing players
    console.log("Clearing existing evaluation players...");
    const { error: deleteError } = await supabase.from("match_players").delete().eq("match_id", EVALUATION_SESSION_ID);
    if (deleteError) {
      console.error("Error clearing existing evaluation players:", deleteError);
      throw deleteError;
    }

    // 3. Add new players
    if (userIds && userIds.length > 0) {
      console.log(`Adding ${userIds.length} players to evaluation...`);
      const inserts = userIds.map((uid: string) => ({
        match_id: EVALUATION_SESSION_ID,
        user_id: uid,
        status: "confirmed"
      }));
      const { error: playersError } = await supabase.from("match_players").insert(inserts);
      if (playersError) {
        console.error("Error inserting evaluation players:", playersError);
        throw playersError;
      }
    }

    res.json({ success: true });
  } catch (e: any) {
    console.error("Server error in /api/evaluation/start:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/evaluation/finish", async (req, res) => {
  try {
    // 1. Get all players that were in this evaluation session
    const { data: sessionPlayers } = await supabase
      .from("match_players")
      .select("user_id")
      .eq("match_id", EVALUATION_SESSION_ID);
    
    if (sessionPlayers && sessionPlayers.length > 0) {
      const playerIds = sessionPlayers.map(sp => sp.user_id);
      
      // 2. For each player, recalculate their average level discarding min/max
      for (const playerId of playerIds) {
        const { data: ratings } = await supabase
          .from("ratings")
          .select("score")
          .eq("rated_id", playerId);
        
        if (ratings && ratings.length > 0) {
          const scores = ratings.map(r => r.score);
          let avg = 0;
          
          if (scores.length >= 3) {
            const sorted = [...scores].sort((a, b) => a - b);
            // Remove one min and one max
            const filtered = sorted.slice(1, -1);
            avg = filtered.reduce((a, b) => a + b, 0) / filtered.length;
          } else {
            avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          }
          
          await supabase.from("users").update({ level: avg }).eq("id", playerId);
        }
      }
    }

    // 3. Archive the ratings of this session by changing their match_id
    // to prevent them from interfering with the "already_rated" check in future sessions
    const archivedSessionId = `archived-${Date.now()}`;
    await supabase.from("ratings").update({ match_id: archivedSessionId }).eq("match_id", EVALUATION_SESSION_ID);

    // 4. Clear the session
    await supabase.from("match_players").delete().eq("match_id", EVALUATION_SESSION_ID);
    res.json({ success: true });
  } catch (e: any) {
    console.error("Error finishing evaluation:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/stats/update", async (req, res) => {
  const { userId, type, increment } = req.body; // type: 'goals' | 'assists'
  try {
    const { data: user, error: fetchError } = await supabase.from("users").select(type).eq("id", userId).single();
    if (fetchError) throw fetchError;
    
    const newValue = Math.max(0, (user?.[type as keyof typeof user] || 0) + (increment || 0));
    const { error: updateError } = await supabase.from("users").update({ [type]: newValue }).eq("id", userId);
    if (updateError) throw updateError;
    
    res.json({ success: true, newValue });
  } catch (e: any) {
    console.error("Error in /api/stats/update:", e);
    res.status(500).json({ error: e.message || "Erro interno ao atualizar estatísticas" });
  }
});

app.post("/api/stats/winner", async (req, res) => {
  const { userIds } = req.body;
  try {
    const errors = [];
    for (const uid of userIds) {
      const { data: user, error: fetchError } = await supabase.from("users").select("wins").eq("id", uid).single();
      if (fetchError) {
        errors.push(`Fetch error for ${uid}: ${fetchError.message}`);
        continue;
      }
      
      const newWins = (user?.wins || 0) + 1;
      const { error: updateError } = await supabase.from("users").update({ wins: newWins }).eq("id", uid);
      if (updateError) {
        errors.push(`Update error for ${uid}: ${updateError.message}`);
      }
    }
    
    if (errors.length > 0) {
      res.status(207).json({ success: false, errors });
    } else {
      res.json({ success: true });
    }
  } catch (e: any) {
    console.error("Error in /api/stats/winner:", e);
    res.status(500).json({ error: e.message || "Erro interno ao registrar vitórias" });
  }
});

app.post("/api/ratings", async (req, res) => {
  const { id, match_id, rater_id, rated_id, score, comment } = req.body;
  try {
    // Always anonymous as per user request
    const { error } = await supabase.from("ratings").insert([{
      id,
      match_id,
      rater_id,
      rated_id,
      score,
      comment,
      is_anonymous: true
    }]);
    
    if (error) throw error;

    // We no longer update level here. It's updated only when the manager finishes the evaluation session.
    
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
