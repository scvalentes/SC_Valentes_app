import React, { useState, useEffect } from "react";
import { 
  Trophy, 
  Users, 
  Calendar, 
  User as UserIcon, 
  Plus, 
  Star, 
  ChevronRight, 
  MapPin, 
  Clock,
  LogOut,
  MessageSquare,
  DollarSign,
  CheckCircle2,
  XCircle,
  Trash2,
  ShieldCheck,
  UserPlus
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type User = {
  id: string;
  name: string;
  username: string;
  nickname: string;
  position: string;
  level: number | null;
  photo_url: string;
  role: 'player' | 'manager' | 'scout';
  match_count: number;
  rating_count: number;
};

type Match = {
  id: string;
  date: string;
  time: string;
  location: string;
  max_players: number;
  status: string;
};

type View = "home" | "rankings" | "profile" | "create-match" | "evaluation" | "manager-dashboard";

export default function App() {
  const [view, setView] = useState<View>("home");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [positionFilter, setPositionFilter] = useState<string>("Todos");
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [teams, setTeams] = useState<{ teamA: User[], teamB: User[] } | null>(null);
  const [ratingTarget, setRatingTarget] = useState<User | null>(null);

  const [showChat, setShowChat] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<User[]>([]);
  const [managerTab, setManagerTab] = useState<"requests" | "all-users">("requests");
  const [selectedForEvaluation, setSelectedForEvaluation] = useState<string[]>([]);
  const [evaluationPlayers, setEvaluationPlayers] = useState<User[]>([]);

  const finishMatch = async (matchId: string) => {
    await fetch(`/api/matches/${matchId}/finish`, { method: "POST" });
    fetchData();
    if (selectedMatch) setSelectedMatch({ ...selectedMatch, status: 'finished' });
  };

  const balanceTeams = () => {
    if (currentUser?.role !== 'manager') return;
    const sorted = [...matchPlayers].sort((a, b) => (b.level ?? 5.0) - (a.level ?? 5.0));
    const teamA: User[] = [];
    const teamB: User[] = [];
    
    sorted.forEach((player, i) => {
      if (i % 2 === 0) teamA.push(player);
      else teamB.push(player);
    });
    
    setTeams({ teamA, teamB });
  };

  const submitRating = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ratingTarget || !currentUser || !selectedMatch) return;

    if (currentUser.role !== 'scout' && currentUser.role !== 'manager') {
      alert("Apenas olheiros e gestores podem avaliar jogadores.");
      return;
    }

    if (currentUser.id === ratingTarget.id) {
      alert("Você não pode avaliar a si mesmo.");
      return;
    }
    
    const formData = new FormData(e.currentTarget);
    const rating = {
      id: Math.random().toString(36).substr(2, 9),
      match_id: selectedMatch.id,
      rater_id: currentUser.id,
      rated_id: ratingTarget.id,
      score: parseFloat(formData.get("score") as string),
      comment: formData.get("comment") as string,
      is_anonymous: formData.get("is_anonymous") === "on"
    };

    await fetch("/api/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rating)
    });

    setRatingTarget(null);
    fetchData();
  };

  const [matchPlayers, setMatchPlayers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const savedUser = localStorage.getItem("pelada_user");
    if (savedUser) {
      try {
        const user = JSON.parse(savedUser);
        if (user && user.id && user.nickname) {
          setCurrentUser(user);
        } else {
          localStorage.removeItem("pelada_user");
        }
      } catch (e) {
        localStorage.removeItem("pelada_user");
      }
    }
    fetchData();
  }, []);

  const fetchEvaluationPlayers = async () => {
    try {
      const res = await fetch("/api/evaluation/players");
      const data = await res.json();
      setEvaluationPlayers(data);
    } catch (error) {
      console.error("Error fetching evaluation players:", error);
    }
  };

  const startEvaluation = async () => {
    if (selectedForEvaluation.length === 0) {
      alert("Selecione pelo menos um jogador para avaliar.");
      return;
    }
    try {
      await fetch("/api/evaluation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: selectedForEvaluation })
      });
      fetchEvaluationPlayers();
      setView("evaluation");
      setSelectedForEvaluation([]);
    } catch (error) {
      console.error("Error starting evaluation:", error);
    }
  };

  const finishEvaluation = async () => {
    if (!window.confirm("Deseja finalizar esta sessão de avaliação?")) return;
    try {
      await fetch("/api/evaluation/finish", { method: "POST" });
      setEvaluationPlayers([]);
      setView("home");
    } catch (error) {
      console.error("Error finishing evaluation:", error);
    }
  };

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [matchesRes, usersRes] = await Promise.all([
        fetch("/api/matches"),
        fetch("/api/users")
      ]);
      const matchesData = await matchesRes.json();
      const usersData = await usersRes.json();
      setMatches(matchesData);
      setUsers(usersData);

      // Update current user data if logged in
      if (currentUser) {
        const updatedUser = usersData.find((u: User) => u.id === currentUser.id);
        if (updatedUser) {
          setCurrentUser(updatedUser);
          localStorage.setItem("pelada_user", JSON.stringify(updatedUser));
        }
        
        if (currentUser.role === 'manager') {
          fetchManagerData();
        }
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMatchPlayers = async (matchId: string) => {
    try {
      const res = await fetch(`/api/matches/${matchId}/players`);
      const data = await res.json();
      setMatchPlayers(data);
    } catch (error) {
      console.error("Error fetching players:", error);
    }
  };

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthError(null);
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name") as string;
    const username = formData.get("username") as string;
    const nickname = formData.get("nickname") as string;
    const position = formData.get("position") as string;
    const password = formData.get("password") as string;

    // Username validation: no spaces, no special characters, no accents
    const usernameRegex = /^[a-zA-Z0-9._]+$/;
    if (!usernameRegex.test(username)) {
      setAuthError("O nome de usuário não pode conter espaços, acentos ou caracteres especiais (apenas letras, números, ponto e sublinhado).");
      return;
    }
    
    const newUser = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      username,
      nickname,
      position,
      password,
      level: null,
      photo_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`
    };

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newUser)
    });

    if (!res.ok) {
      const data = await res.json();
      setAuthError(data.error || "Erro ao criar conta");
      return;
    }

    const savedUser = await res.json();
    setCurrentUser(savedUser);
    localStorage.setItem("pelada_user", JSON.stringify(savedUser));
    fetchData();
  };

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthError(null);
    const formData = new FormData(e.currentTarget);
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      const data = await res.json();
      setAuthError(data.error || "Erro ao entrar");
      return;
    }

    const user = await res.json();
    setCurrentUser(user);
    localStorage.setItem("pelada_user", JSON.stringify(user));
    fetchData();
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem("pelada_user");
    setView("home");
  };

  const fetchManagerData = async () => {
    if (!currentUser) return;
    try {
      const [reqsRes, authRes] = await Promise.all([
        fetch(`/api/manager/${currentUser.id}/requests`),
        fetch(`/api/manager/${currentUser.id}/authorized-users`)
      ]);
      setPendingRequests(await reqsRes.json());
      setAuthorizedUsers(await authRes.json());
    } catch (error) {
      console.error("Error fetching manager data:", error);
    }
  };

  const approveRequest = async (userId: string, matchId: string) => {
    if (!currentUser) return;
    try {
      await fetch(`/api/manager/${currentUser.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, matchId })
      });
      fetchManagerData();
      fetchMatchPlayers(matchId);
    } catch (error) {
      console.error("Error approving request:", error);
    }
  };

  const rejectRequest = async (userId: string, matchId: string) => {
    if (!currentUser) return;
    try {
      await fetch(`/api/manager/${currentUser.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, matchId })
      });
      fetchManagerData();
    } catch (error) {
      console.error("Error rejecting request:", error);
    }
  };

  const revokeAuthorization = async (userId: string) => {
    if (!currentUser) return;
    try {
      await fetch(`/api/manager/${currentUser.id}/authorized-users/${userId}`, {
        method: "DELETE"
      });
      fetchManagerData();
    } catch (error) {
      console.error("Error revoking authorization:", error);
    }
  };

  const toggleScoutRole = async (userId: string, currentRole: string) => {
    if (!currentUser) return;
    const newRole = currentRole === 'scout' ? 'player' : 'scout';
    try {
      await fetch(`/api/manager/${currentUser.id}/update-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole })
      });
      fetchManagerData();
      fetchData();
    } catch (error) {
      console.error("Error updating user role:", error);
    }
  };

  const handleCreateMatch = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!currentUser) return;
    
    const formData = new FormData(e.currentTarget);
    const newMatch = {
      id: Math.random().toString(36).substr(2, 9),
      date: formData.get("date") as string,
      time: formData.get("time") as string,
      location: formData.get("location") as string,
      max_players: parseInt(formData.get("max_players") as string),
      userId: currentUser.id
    };

    const res = await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newMatch)
    });

    if (res.ok) {
      setView("home");
      fetchData();
    } else {
      const data = await res.json();
      alert(data.error || "Erro ao criar pelada");
    }
  };

  const joinMatch = async (matchId: string) => {
    if (!currentUser) return;
    const res = await fetch(`/api/matches/${matchId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUser.id })
    });
    const data = await res.json();
    if (data.status === 'pending') {
      alert("Sua solicitação foi enviada ao gestor. Você será notificado quando for aprovado.");
    }
    fetchMatchPlayers(matchId);
  };

  const deleteUser = async (userId: string) => {
    if (!currentUser || currentUser.role !== 'manager') return;
    if (!window.confirm("Tem certeza que deseja remover este jogador permanentemente?")) return;

    const res = await fetch(`/api/users/${userId}`, {
      method: "DELETE",
      headers: { 
        "Content-Type": "application/json",
        "x-manager-id": currentUser.id
      }
    });

    if (res.ok) {
      fetchData();
    } else {
      const data = await res.json();
      alert(data.error || "Erro ao remover jogador");
    }
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-200"
        >
          <div className="flex justify-center mb-6">
            <div className="bg-primary p-4 rounded-full shadow-lg shadow-primary/20">
              <Trophy className="w-10 h-10 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 text-center mb-2">SC Valentes</h1>
          <p className="text-slate-500 text-center mb-8">
            {authMode === "login" ? "Entre na sua conta" : "Crie seu perfil para começar a jogar."}
          </p>
          
          {authError && (
            <div className="bg-secondary/10 border border-secondary/20 text-secondary p-3 rounded-lg text-sm mb-6 text-center">
              {authError}
            </div>
          )}

          {authMode === "signup" ? (
            <form onSubmit={handleSignUp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome Completo</label>
                <input 
                  name="name" 
                  required 
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-slate-900 focus:ring-2 focus:ring-primary outline-none transition-all"
                  placeholder="Ex: Roberto Silva"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome de Usuário (Login)</label>
                <input 
                  name="username" 
                  required 
                  minLength={4}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-slate-900 focus:ring-2 focus:ring-primary outline-none transition-all"
                  placeholder="Ex: beto_silva"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Mínimo 4 caracteres. Apenas letras, números, ponto (.) e sublinhado (_).
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Apelido (No App)</label>
                <input 
                  name="nickname" 
                  required 
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-slate-900 focus:ring-2 focus:ring-primary outline-none transition-all"
                  placeholder="Ex: Beto"
                />
                <p className="text-[10px] text-slate-500 mt-1">Este é o nome que todos verão. Pode ser comum.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Posição</label>
                <select 
                  name="position" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-slate-900 focus:ring-2 focus:ring-primary outline-none transition-all"
                >
                  <option value="Goleiro">Goleiro</option>
                  <option value="Fixo">Fixo</option>
                  <option value="Ala">Ala</option>
                  <option value="Meia">Meia</option>
                  <option value="Pivô">Pivô</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Senha</label>
                <input 
                  name="password" 
                  type="password"
                  required 
                  minLength={4}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-slate-900 focus:ring-2 focus:ring-primary outline-none transition-all"
                  placeholder="••••••••"
                />
                <p className="text-[10px] text-slate-500 mt-1">Mínimo 4 caracteres.</p>
              </div>
              <button 
                type="submit"
                className="w-full bg-primary hover:opacity-90 text-white font-bold py-3 rounded-lg transition-colors shadow-lg shadow-primary/20 mt-4"
              >
                Criar Perfil
              </button>
              <p className="text-center text-sm text-slate-500 mt-4">
                Já tem uma conta?{" "}
                <button 
                  type="button"
                  onClick={() => setAuthMode("login")}
                  className="text-primary hover:underline font-medium"
                >
                  Entrar
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome de Usuário</label>
                <input 
                  name="username" 
                  required 
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-slate-900 focus:ring-2 focus:ring-primary outline-none transition-all"
                  placeholder="Ex: beto_silva"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Senha</label>
                <input 
                  name="password" 
                  type="password"
                  required 
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-slate-900 focus:ring-2 focus:ring-primary outline-none transition-all"
                  placeholder="••••••••"
                />
              </div>
              <button 
                type="submit"
                className="w-full bg-primary hover:opacity-90 text-white font-bold py-3 rounded-lg transition-colors shadow-lg shadow-primary/20 mt-4"
              >
                Entrar na Arena
              </button>
              <p className="text-center text-sm text-slate-500 mt-4">
                Não tem uma conta?{" "}
                <button 
                  type="button"
                  onClick={() => setAuthMode("signup")}
                  className="text-primary hover:underline font-medium"
                >
                  Criar Perfil
                </button>
              </p>
            </form>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 pb-24">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView("home")}>
            <Trophy className="w-6 h-6 text-primary" />
            <span className="font-bold text-xl tracking-tight text-primary">SC Valentes</span>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setView("profile")}
              className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-100 transition-colors"
            >
              <img src={currentUser.photo_url} className="w-6 h-6 rounded-full" />
              <span className="text-sm font-medium text-slate-700">{currentUser.nickname}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {view === "home" && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-900">Próximas Peladas</h2>
                {currentUser.role === 'manager' && (
                  <button 
                    onClick={() => setView("create-match")}
                    className="bg-primary hover:opacity-90 p-2 rounded-full shadow-lg shadow-primary/20 transition-colors text-white"
                  >
                    <Plus className="w-6 h-6" />
                  </button>
                )}
              </div>

              {matches.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
                  <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500">Nenhuma pelada marcada. Que tal criar uma?</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {matches.map(match => (
                    <div 
                      key={match.id}
                      className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-primary/50 transition-all cursor-pointer group shadow-sm hover:shadow-md"
                      onClick={() => {
                        setSelectedMatch(match);
                        fetchMatchPlayers(match.id);
                        // No longer going to match-details view
                      }}
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="text-lg font-bold mb-1 text-slate-900">{match.location}</h3>
                          <div className="flex items-center gap-3 text-sm text-slate-500">
                            <span className="flex items-center gap-1"><Calendar className="w-4 h-4 text-primary" /> {match.date}</span>
                            <span className="flex items-center gap-1"><Clock className="w-4 h-4 text-primary" /> {match.time}</span>
                          </div>
                        </div>
                        <div className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                          {match.status === 'open' ? 'Aberto' : 'Finalizado'}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-slate-400" />
                          <span className="text-sm text-slate-500">Limite: {match.max_players} jogadores</span>
                        </div>
                        <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-primary transition-colors" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {view === "create-match" && (
            <motion.div 
              key="create"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm"
            >
              <h2 className="text-2xl font-bold mb-6 text-slate-900">Marcar Nova Pelada</h2>
              <form onSubmit={handleCreateMatch} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">Data</label>
                    <input name="date" type="date" required className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">Horário</label>
                    <input name="time" type="time" required className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">Local</label>
                  <input name="location" placeholder="Ex: Arena Soccer City" required className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">Limite de Jogadores</label>
                  <input name="max_players" type="number" defaultValue={12} required className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button" 
                    onClick={() => setView("home")}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-3 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-primary hover:opacity-90 text-white font-bold py-3 rounded-lg transition-colors shadow-lg shadow-primary/20"
                  >
                    Confirmar
                  </button>
                </div>
              </form>
            </motion.div>
          )}

          {view === "manager-dashboard" && currentUser.role === 'manager' && (
            <motion.div 
              key="manager"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-900">Painel do Gestor</h2>
              </div>

              <div className="flex gap-2 border-b border-slate-200">
                <button 
                  onClick={() => setManagerTab("requests")}
                  className={cn(
                    "px-4 py-2 font-bold text-sm transition-all relative",
                    managerTab === "requests" ? "text-primary" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Solicitações ({pendingRequests.length})
                  {managerTab === "requests" && <motion.div layoutId="tab" className="absolute bottom-0 left-0 w-full h-0.5 bg-primary" />}
                </button>
                <button 
                  onClick={() => setManagerTab("all-users")}
                  className={cn(
                    "px-4 py-2 font-bold text-sm transition-all relative",
                    managerTab === "all-users" ? "text-primary" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Todos os Usuários ({users.length})
                  {managerTab === "all-users" && <motion.div layoutId="tab" className="absolute bottom-0 left-0 w-full h-0.5 bg-primary" />}
                </button>
              </div>

              {managerTab === "requests" ? (
                <div className="space-y-4">
                  {pendingRequests.length === 0 ? (
                    <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
                      <UserPlus className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                      <p className="text-slate-500">Nenhuma solicitação pendente.</p>
                    </div>
                  ) : (
                    pendingRequests.map(req => (
                      <div key={`${req.match_id}-${req.user_id}`} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <img src={req.photo_url} className="w-12 h-12 rounded-full" />
                          <div>
                            <div className="font-bold text-slate-900">{req.nickname}</div>
                            <div className="text-xs text-slate-500">Solicitou participar em: <span className="font-medium text-primary">{req.location}</span></div>
                            <div className="text-[10px] text-slate-400">{req.date} às {req.time}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => rejectRequest(req.user_id, req.match_id)}
                            className="p-2 text-slate-400 hover:text-secondary transition-colors"
                            title="Recusar"
                          >
                            <XCircle className="w-6 h-6" />
                          </button>
                          <button 
                            onClick={() => approveRequest(req.user_id, req.match_id)}
                            className="p-2 text-primary hover:bg-primary/10 rounded-full transition-colors"
                            title="Aprovar"
                          >
                            <CheckCircle2 className="w-6 h-6" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="text-sm text-slate-500">
                      {selectedForEvaluation.length} jogadores selecionados
                    </div>
                    <button 
                      onClick={startEvaluation}
                      disabled={selectedForEvaluation.length === 0}
                      className="bg-primary hover:opacity-90 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-lg shadow-primary/20 flex items-center gap-2"
                    >
                      <Star className="w-4 h-4" />
                      Avaliar Selecionados
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="px-6 py-4 font-medium w-10">
                            <input 
                              type="checkbox" 
                              className="accent-primary"
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedForEvaluation(users.filter(u => u.role !== 'manager').map(u => u.id));
                                } else {
                                  setSelectedForEvaluation([]);
                                }
                              }}
                              checked={selectedForEvaluation.length === users.filter(u => u.role !== 'manager').length && users.length > 0}
                            />
                          </th>
                          <th className="px-6 py-4 font-medium">Jogador</th>
                          <th className="px-6 py-4 font-medium">Posição</th>
                          <th className="px-6 py-4 font-medium">Cargo</th>
                          <th className="px-6 py-4 font-medium text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {users.map(user => (
                          <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4">
                              {user.role !== 'manager' && (
                                <input 
                                  type="checkbox" 
                                  className="accent-primary"
                                  checked={selectedForEvaluation.includes(user.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedForEvaluation([...selectedForEvaluation, user.id]);
                                    } else {
                                      setSelectedForEvaluation(selectedForEvaluation.filter(id => id !== user.id));
                                    }
                                  }}
                                />
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <img src={user.photo_url} className="w-8 h-8 rounded-full" />
                                <div>
                                  <div className="font-bold text-slate-900">{user.nickname}</div>
                                  <div className="text-xs text-slate-500">{user.name}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-600">{user.position}</td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "text-[10px] font-bold uppercase px-2 py-1 rounded-full",
                                user.role === 'manager' ? "bg-primary/10 text-primary" :
                                user.role === 'scout' ? "bg-secondary/10 text-secondary" :
                                "bg-slate-100 text-slate-500"
                              )}>
                                {user.role === 'manager' ? "Gestor" : user.role === 'scout' ? "Olheiro" : "Jogador"}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {user.role !== 'manager' && (
                                  <>
                                    <button 
                                      onClick={() => toggleScoutRole(user.id, user.role)}
                                      className={cn(
                                        "px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-colors border",
                                        user.role === 'scout' 
                                          ? "bg-secondary text-white border-secondary hover:bg-secondary/90" 
                                          : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                                      )}
                                      title={user.role === 'scout' ? "Tirar Olheiro" : "Tornar Olheiro"}
                                    >
                                      {user.role === 'scout' ? "Tirar Olheiro" : "Tornar Olheiro"}
                                    </button>
                                    <button 
                                      onClick={() => deleteUser(user.id)}
                                      className="p-2 text-slate-400 hover:text-secondary transition-colors"
                                      title="Excluir Cadastro"
                                    >
                                      <Trash2 className="w-5 h-5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </motion.div>
          )}
          {view === "rankings" && (
            <motion.div 
              key="rankings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-900">Ranking Geral</h2>
                <div className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                  <Trophy className="w-3 h-3" />
                  Temporada 2026
                </div>
              </div>

              {/* Position Filter */}
              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                {["Todos", "Goleiro", "Fixo", "Ala", "Meia", "Pivô"].map((pos) => (
                  <button
                    key={pos}
                    onClick={() => setPositionFilter(pos)}
                    className={cn(
                      "px-4 py-2 rounded-full text-sm font-bold transition-all whitespace-nowrap",
                      positionFilter === pos 
                        ? "bg-primary text-white shadow-lg shadow-primary/20" 
                        : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
                    )}
                  >
                    {pos}
                  </button>
                ))}
              </div>

              {/* Highlights & Table */}
              {(() => {
                const filteredUsers = users.filter(u => positionFilter === "Todos" || u.position === positionFilter);
                
                return (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-gradient-to-br from-primary to-primary/80 rounded-2xl p-5 shadow-lg shadow-primary/20 relative overflow-hidden group">
                        <div className="absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-transform">
                          <Trophy className="w-24 h-24 text-white" />
                        </div>
                        <div className="relative z-10">
                          <div className="text-xs font-bold uppercase text-white/70 mb-2">Melhor Jogador</div>
                          {filteredUsers.length > 0 ? (
                            <div className="flex items-center gap-3">
                              <img src={filteredUsers[0].photo_url} className="w-10 h-10 rounded-full border-2 border-white/20" />
                              <div>
                                <div className="font-bold text-white">{filteredUsers[0].nickname}</div>
                                <div className="text-xs text-white/80 flex items-center gap-1">
                                  <Star className="w-3 h-3 fill-white" />
                                  {filteredUsers[0].level !== null && filteredUsers[0].level !== undefined ? filteredUsers[0].level.toFixed(1) : "-"}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="text-white/70 text-sm">Nenhum jogador</div>
                          )}
                        </div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-2xl p-5 relative overflow-hidden group shadow-sm">
                        <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform">
                          <Star className="w-24 h-24 text-primary" />
                        </div>
                        <div className="relative z-10">
                          <div className="text-xs font-bold uppercase text-slate-400 mb-2">Mais Votado</div>
                          {filteredUsers.length > 0 ? (
                            (() => {
                              const mostRated = [...filteredUsers].sort((a, b) => b.rating_count - a.rating_count)[0];
                              return (
                                <div className="flex items-center gap-3">
                                  <img src={mostRated.photo_url} className="w-10 h-10 rounded-full border-2 border-slate-100" />
                                  <div>
                                    <div className="font-bold text-slate-900">{mostRated.nickname}</div>
                                    <div className="text-xs text-slate-500">{mostRated.rating_count} avaliações</div>
                                  </div>
                                </div>
                              );
                            })()
                          ) : (
                            <div className="text-slate-400 text-sm">Nenhum jogador</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                          <tr>
                            <th className="px-6 py-4 font-medium">Pos</th>
                            <th className="px-6 py-4 font-medium">Jogador</th>
                            <th className="px-6 py-4 font-medium">Posição</th>
                            <th className="px-6 py-4 font-medium text-center">Partidas</th>
                            <th className="px-6 py-4 font-medium text-right">Nível</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredUsers.map((user, index) => (
                            <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-6 py-4">
                                <span className={cn(
                                  "w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold",
                                  index === 0 ? "bg-yellow-500 text-black" : 
                                  index === 1 ? "bg-slate-200 text-black" :
                                  index === 2 ? "bg-amber-600 text-white" : "text-slate-400"
                                )}>
                                  {index + 1}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <img src={user.photo_url} className="w-8 h-8 rounded-full" />
                                  <div>
                                    <div className="font-bold text-slate-900">{user.nickname}</div>
                                    <div className="text-xs text-slate-500">{user.name}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-sm text-slate-600">{user.position}</td>
                              <td className="px-6 py-4 text-sm text-slate-600 text-center">{user.match_count || 0}</td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-3">
                                  <div className="flex items-center gap-1 text-primary font-bold">
                                    <Star className="w-4 h-4 fill-primary" />
                                    {user.level !== null && user.level !== undefined ? user.level.toFixed(1) : "-"}
                                  </div>
                                  {currentUser.role === 'manager' && currentUser.id !== user.id && (
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteUser(user.id);
                                      }}
                                      className="p-1.5 text-slate-300 hover:text-secondary transition-colors"
                                      title="Remover Jogador"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
            </motion.div>
          )}

          {view === "profile" && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center relative overflow-hidden shadow-sm">
                <div className="absolute top-0 left-0 w-full h-24 bg-primary/5" />
                <div className="relative z-10">
                  <img src={currentUser.photo_url} className="w-24 h-24 rounded-full mx-auto mb-4 border-4 border-white shadow-xl" />
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <h2 className="text-2xl font-bold text-slate-900">{currentUser.name}</h2>
                    {currentUser.role === 'manager' && (
                      <span className="bg-primary/10 text-primary text-[10px] font-bold uppercase px-2 py-0.5 rounded-full">
                        Gestor
                      </span>
                    )}
                  </div>
                  <p className="text-primary font-medium mb-6">@{currentUser.nickname}</p>
                  
                  <div className="grid grid-cols-3 gap-4 mb-8">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <div className="text-xs text-slate-500 uppercase mb-1">Nível</div>
                      <div className="text-xl font-bold text-primary flex items-center justify-center gap-1">
                        <Star className="w-4 h-4 fill-primary" />
                        {currentUser.level !== null ? currentUser.level.toFixed(1) : "-"}
                      </div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <div className="text-xs text-slate-500 uppercase mb-1">Posição</div>
                      <div className="text-sm font-bold text-slate-900">{currentUser.position}</div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <div className="text-xs text-slate-500 uppercase mb-1">Partidas</div>
                      <div className="text-xl font-bold text-slate-900">{currentUser.match_count || 0}</div>
                    </div>
                  </div>

                  <button 
                    onClick={handleLogout}
                    className="flex items-center gap-2 text-secondary hover:opacity-80 transition-colors mx-auto font-medium"
                  >
                    <LogOut className="w-4 h-4" />
                    Sair da conta
                  </button>
                </div>
              </div>

            </motion.div>
          )}

          {view === "evaluation" && (currentUser.role === 'manager' || currentUser.role === 'scout') && (
            <motion.div 
              key="evaluation"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-900">Avaliação de Jogadores</h2>
                {currentUser.role === 'manager' && (
                  <button 
                    onClick={finishEvaluation}
                    className="text-xs text-secondary hover:underline font-bold"
                  >
                    Finalizar Sessão
                  </button>
                )}
              </div>

              {evaluationPlayers.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
                  <Star className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500">Nenhum jogador selecionado para avaliação.</p>
                  {currentUser.role === 'manager' && (
                    <button 
                      onClick={() => setView("manager-dashboard")}
                      className="text-primary font-bold mt-4 hover:underline"
                    >
                      Ir para o Painel do Gestor
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid gap-4">
                  {evaluationPlayers.map(player => (
                    <div key={player.id} className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center justify-between shadow-sm hover:shadow-md transition-all">
                      <div className="flex items-center gap-4">
                        <img src={player.photo_url} className="w-14 h-14 rounded-full border-2 border-slate-100" />
                        <div>
                          <div className="font-bold text-lg text-slate-900">{player.nickname}</div>
                          <div className="text-sm text-slate-500">{player.position}</div>
                          <div className="flex items-center gap-1 text-primary font-bold text-xs mt-1">
                            <Star className="w-3.5 h-3.5 fill-primary" />
                            Nível: {player.level !== null ? player.level.toFixed(1) : "-"}
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          setRatingTarget(player);
                          // We need a match_id for ratings, we'll use 'evaluation_session'
                          setSelectedMatch({ id: 'evaluation_session' } as any);
                        }}
                        className="bg-primary hover:opacity-90 text-white px-6 py-2 rounded-xl font-bold transition-all shadow-lg shadow-primary/20"
                      >
                        Avaliar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Rating Modal */}
      <AnimatePresence>
        {ratingTarget && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            >
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3">
                  <img src={ratingTarget.photo_url} className="w-12 h-12 rounded-full" />
                  <div>
                    <h3 className="font-bold text-lg text-slate-900">Avaliar {ratingTarget.nickname}</h3>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-slate-500">{ratingTarget.position}</p>
                      <span className="text-slate-300">•</span>
                      <div className="flex items-center gap-1 text-primary font-bold text-xs">
                        <Star className="w-3 h-3 fill-primary" />
                        Média: {ratingTarget.level !== null ? ratingTarget.level.toFixed(1) : "N/A"}
                      </div>
                    </div>
                  </div>
                </div>
                <button onClick={() => setRatingTarget(null)} className="text-slate-400 hover:text-secondary">
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={submitRating} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-2">Nota (1 a 10)</label>
                  <div className="flex justify-between gap-1">
                    {[1,2,3,4,5,6,7,8,9,10].map(n => (
                      <label key={n} className="flex-1">
                        <input type="radio" name="score" value={n} required className="peer hidden" />
                        <div className="h-8 flex items-center justify-center bg-slate-100 rounded-md text-xs font-bold peer-checked:bg-primary peer-checked:text-white cursor-pointer transition-colors text-slate-600">
                          {n}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">Comentário (Opcional)</label>
                  <textarea 
                    name="comment"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-primary h-20 resize-none"
                    placeholder="Ex: Jogou muito, bom espírito esportivo!"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" name="is_anonymous" id="anon" className="accent-primary" />
                  <label htmlFor="anon" className="text-sm text-slate-500">Avaliação Anônima</label>
                </div>
                <button 
                  type="submit"
                  className="w-full bg-primary hover:opacity-90 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-primary/20"
                >
                  Enviar Avaliação
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 w-full bg-white/80 backdrop-blur-lg border-t border-slate-200 z-50">
        <div className="max-w-4xl mx-auto px-6 h-20 flex items-center justify-between">
          <button 
            onClick={() => setView("home")}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 transition-colors",
              view === "home" ? "text-primary" : "text-slate-400 hover:text-primary"
            )}
          >
            <Calendar className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Jogos</span>
          </button>
          
          {currentUser.role === 'manager' && (
            <button 
              onClick={() => setView("manager-dashboard")}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 transition-colors relative",
                view === "manager-dashboard" ? "text-primary" : "text-slate-400 hover:text-primary"
              )}
            >
              <ShieldCheck className="w-6 h-6" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Gestor</span>
              {pendingRequests.length > 0 && (
                <span className="absolute top-0 right-1/4 bg-secondary text-white text-[8px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center border border-white">
                  {pendingRequests.length}
                </span>
              )}
            </button>
          )}

          {(currentUser.role === 'manager' || currentUser.role === 'scout') && (
            <button 
              onClick={() => {
                fetchEvaluationPlayers();
                setView("evaluation");
              }}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 transition-colors",
                view === "evaluation" ? "text-primary" : "text-slate-400 hover:text-primary"
              )}
            >
              <Star className="w-6 h-6" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Avaliar</span>
            </button>
          )}

          <button 
            onClick={() => setView("rankings")}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 transition-colors",
              view === "rankings" ? "text-primary" : "text-slate-400 hover:text-primary"
            )}
          >
            <Trophy className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Ranking</span>
          </button>
          <button 
            onClick={() => setView("profile")}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 transition-colors",
              view === "profile" ? "text-primary" : "text-slate-400 hover:text-primary"
            )}
          >
            <UserIcon className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Perfil</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
