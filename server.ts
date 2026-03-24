import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in environment variables.");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  
  // Users
  app.get("/api/users", async (req, res) => {
    try {
      // In Supabase, we can't easily do subqueries in the same select for counts without RPC or views
      // For simplicity, we'll fetch users and then handle counts if needed, or just return users
      // To match the previous behavior exactly, we'd need a more complex query or a view.
      // Let's assume we have a view or just return the data we have.
      const { data, error } = await supabase
        .from("users")
        .select(`
          *,
          match_count:match_players(count),
          rating_count:ratings!ratings_rated_id_fkey(count)
        `)
        .order("level", { ascending: false, nullsFirst: false });

      if (error) throw error;

      // Transform counts from Supabase format { count: X } to number
      const transformed = data.map(u => ({
        ...u,
        match_count: u.match_count?.[0]?.count || 0,
        rating_count: u.rating_count?.[0]?.count || 0
      }));

      res.json(transformed);
    } catch (e) {
      console.error(e);
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
    
    if (username.length < 4) return res.status(400).json({ error: "O nome de usuário deve ter no mínimo 4 caracteres." });
    if (password.length < 4) return res.status(400).json({ error: "A senha deve ter no mínimo 4 caracteres." });

    const usernameRegex = /^[a-zA-Z0-9._]+$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ error: "O nome de usuário não pode conter espaços, acentos ou caracteres especiais." });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Check if this is the first user
      const { count } = await supabase.from("users").select("*", { count: 'exact', head: true });
      const role = count === 0 ? 'manager' : 'player';

      const { data, error } = await supabase
        .from("users")
        .insert([{ id, name, username, nickname, position, photo_url, password: hashedPassword, role }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({ ...data, match_count: 0, rating_count: 0 });
    } catch (e) {
      console.error("Error creating user:", e);
      res.status(400).json({ error: "Erro ao criar usuário. O nome de usuário já pode estar em uso." });
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

      if (error || !user) {
        return res.status(401).json({ error: "Usuário não encontrado" });
      }

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return res.status(401).json({ error: "Senha incorreta" });
      }

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
    if (!managerId) return res.status(401).json({ error: "Unauthorized" });
    
    const { data: manager } = await supabase.from("users").select("role").eq("id", managerId).single();
    if (!manager || manager.role !== 'manager') {
      return res.status(403).json({ error: "Apenas gestores podem remover jogadores." });
    }

    const userId = req.params.id;
    
    try {
      // Supabase handles cascading deletes if configured in DB
      await supabase.from("users").delete().eq("id", userId);
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
      .order("date", { ascending: false })
      .order("time", { ascending: false })
      .order("created_at", { ascending: false });
    
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/matches", async (req, res) => {
    const { id, date, time, location, max_players, userId } = req.body;
    
    const { data: user } = await supabase.from("users").select("role").eq("id", userId).single();
    if (!user || user.role !== 'manager') {
      return res.status(403).json({ error: "Apenas gestores podem criar peladas." });
    }

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
      .select(`
        status,
        user:users(id, name, username, nickname, position, level, photo_url)
      `)
      .eq("match_id", req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    
    const transformed = data.map(mp => ({
      ...(mp.user as any),
      match_status: mp.status
    }));
    res.json(transformed);
  });

  app.post("/api/matches/:id/finish", async (req, res) => {
    const { error } = await supabase
      .from("matches")
      .update({ status: 'finished' })
      .eq("id", req.params.id);
    
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  });

  app.get("/api/matches/:id/ratings", async (req, res) => {
    const { data, error } = await supabase
      .from("ratings")
      .select("*")
      .eq("match_id", req.params.id);
    
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
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
      const { count } = await supabase
        .from("match_players")
        .select("*", { count: 'exact', head: true })
        .eq("match_id", matchId)
        .eq("status", "confirmed");

      const status = (count || 0) < match.max_players ? 'confirmed' : 'reserve';
      
      const { error } = await supabase
        .from("match_players")
        .insert([{ match_id: matchId, user_id: userId, status }]);

      if (error) return res.status(400).json({ error: "Already joined" });
      res.json({ status, authorized: true });
    } else {
      const { error } = await supabase
        .from("match_players")
        .insert([{ match_id: matchId, user_id: userId, status: 'pending' }]);

      if (error) return res.status(400).json({ error: "Request already sent" });
      res.json({ status: 'pending', authorized: false });
    }
  });

  // Manager Dashboard Endpoints
  app.get("/api/manager/:id/requests", async (req, res) => {
    const managerId = req.params.id;
    const { data, error } = await supabase
      .from("match_players")
      .select(`
        match_id,
        user_id,
        status,
        user:users(name, nickname, photo_url, position, level),
        match:matches(location, date, time, created_by)
      `)
      .eq("status", "pending");

    if (error) return res.status(500).json({ error: error.message });

    // Filter by manager manually since we can't easily filter by nested join in simple select
    const filtered = data.filter((mp: any) => mp.match.created_by === managerId).map((mp: any) => ({
      match_id: mp.match_id,
      user_id: mp.user_id,
      name: mp.user.name,
      nickname: mp.user.nickname,
      photo_url: mp.user.photo_url,
      position: mp.user.position,
      level: mp.user.level,
      location: mp.match.location,
      date: mp.match.date,
      time: mp.match.time
    }));

    res.json(filtered);
  });

  app.post("/api/manager/:id/approve", async (req, res) => {
    const managerId = req.params.id;
    const { userId, matchId } = req.body;

    try {
      await supabase.from("manager_authorizations").upsert([{ manager_id: managerId, user_id: userId }]);
      
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
    const { userId, matchId } = req.body;
    await supabase.from("match_players").delete().eq("match_id", matchId).eq("user_id", userId).eq("status", "pending");
    res.json({ success: true });
  });

  app.get("/api/manager/:id/authorized-users", async (req, res) => {
    const managerId = req.params.id;
    const { data, error } = await supabase
      .from("manager_authorizations")
      .select(`
        created_at,
        user:users(id, name, nickname, photo_url, position, level, role)
      `)
      .eq("manager_id", managerId);

    if (error) return res.status(500).json({ error: error.message });
    
    const transformed = data.map(ma => ({
      ...(ma.user as any),
      authorized_at: ma.created_at
    }));
    res.json(transformed);
  });

  app.post("/api/manager/:id/update-role", async (req, res) => {
    const { userId, role } = req.body;
    if (!['player', 'scout'].includes(role)) return res.status(400).json({ error: "Papel inválido" });
    
    const { error } = await supabase.from("users").update({ role }).eq("id", userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.delete("/api/manager/:id/authorized-users/:userId", async (req, res) => {
    const managerId = req.params.id;
    const userId = req.params.userId;
    const { error } = await supabase.from("manager_authorizations").delete().eq("manager_id", managerId).eq("user_id", userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Ratings
  app.post("/api/ratings", async (req, res) => {
    const { id, match_id, rater_id, rated_id, score, comment, is_anonymous } = req.body;
    
    if (rater_id === rated_id) return res.status(400).json({ error: "Você não pode avaliar a si mesmo" });

    const { data: rater } = await supabase.from("users").select("role").eq("id", rater_id).single();
    if (!rater || (rater.role !== 'scout' && rater.role !== 'manager')) {
      return res.status(403).json({ error: "Apenas olheiros e gestores podem avaliar jogadores." });
    }

    const { error } = await supabase
      .from("ratings")
      .insert([{ id, match_id, rater_id, rated_id, score, comment, is_anonymous }]);

    if (error) return res.status(400).json({ error: error.message });
    
    // Update user level
    const { data: ratings } = await supabase.from("ratings").select("score").eq("rated_id", rated_id);
    if (ratings && ratings.length > 0) {
      const avg = ratings.reduce((acc, curr) => acc + curr.score, 0) / ratings.length;
      await supabase.from("users").update({ level: avg }).eq("id", rated_id);
    }
    
    res.status(201).json({ success: true });
  });

  app.get("/api/rankings", async (req, res) => {
    const { data, error } = await supabase
      .from("users")
      .select("id, name, username, nickname, position, level, photo_url, created_at")
      .order("level", { ascending: false, nullsFirst: false });
    
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
