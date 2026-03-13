require('dotenv').config();
const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require('axios');
const dayjs = require("dayjs");
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const SQLiteStore = require('connect-sqlite3')(session);
const db = require("./src/db");

// --- EXECUTA MIGRAÇÃO AUTOMÁTICA AO INICIAR ---
require('./scripts/migrate.js');

const { parseCsvByCardName } = require("./src/importers");
const { formatBRLFromCents, parseMonthYear, toISOFromBRDate, centsFromPtBrMoney } = require("./src/utils");
const formatDateBR = (dateStr) => { if (!dateStr) return "-"; return dayjs(dateStr).format("DD/MM/YYYY"); };
const { computeDueDate } = require("./src/dueDate");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// --- MIDDLEWARES DE BODY PARSER (DEVE VIR ANTES DAS ROTAS) ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// --- CONFIGURAÇÃO DE SESSÃO E AUTH ---
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: './' }),
  secret: process.env.SESSION_SECRET || 'chave-secreta-padrao',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

// ===== GOOGLE OAUTH STRATEGY =====
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3001/auth/google/callback"
  }, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value;
    const name = profile.displayName;
    const googleId = profile.id;

    if (!email) {
      return done(null, false, { message: 'Email não encontrado no perfil Google.' });
    }

    // Verifica se o email está autorizado
    const authorizedUser = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    
    if (!authorizedUser) {
      return done(null, false, { message: 'Email não autorizado. Entre em contato com o administrador.' });
    }

    // Atualiza last_login
    db.prepare("UPDATE users SET last_login = ? WHERE email = ?").run(dayjs().toISOString(), email);

    // Retorna o usuário
    return done(null, { id: authorizedUser.id, email, name: authorizedUser.name || name });
  }));
} else {
  console.warn('⚠️  Google OAuth não configurado. Verifique GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env');
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// ===== MIDDLEWARE DE AUTENTICAÇÃO =====
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

// ===== ROTAS DE AUTH =====
app.get('/login', (req, res) => {
  res.render('login_oauth', { error: null });
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', passport.authenticate('google', {
  successRedirect: '/',
  failureRedirect: '/login?error=auth_failed'
}));

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).send('Erro ao fazer logout');
    req.session.destroy(() => {
      res.redirect('/login');
    });
  });
});

// ===== CONFIGURAÇÃO DE VIEWS =====
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// ===== MIDDLEWARE GLOBAL =====
app.use((req, res, next) => {
  if (req.isAuthenticated()) {
    res.locals.user = req.user;
    res.locals.userId = req.user.id;
  }
  res.locals.formatDateBR = formatDateBR;
  next();
});

// ===== FUNÇÕES AUXILIARES =====
function nowIso() { return dayjs().toISOString(); }

function getCards(userId) { 
  return db.prepare("SELECT id, name, due_day, holiday_scope FROM cards WHERE user_id = ? ORDER BY name").all(userId); 
}

function getPeopleAll(userId) { 
  return db.prepare("SELECT id, name, active FROM people WHERE user_id = ? ORDER BY active DESC, name").all(userId); 
}

function getPeopleActive(userId) { 
  return db.prepare("SELECT id, name FROM people WHERE user_id = ? AND active=1 ORDER BY name").all(userId); 
}

function likeParam(s) { return `%${String(s).trim()}%`; }

// ===== ROTA HOME =====
app.get("/", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const owner = db.prepare("SELECT id FROM people WHERE user_id = ? AND is_owner = 1 LIMIT 1").get(userId);
  
  if (!owner) {
    return res.redirect('/people');
  }
  
  const d = new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  res.redirect(`/detalhamento/${year}/${month}`);
});

// ===== PÁGINA DE ADMIN (GERENCIAR USUÁRIOS) =====
app.get("/admin", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  
  // Verifica se é admin
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  if (user?.role !== 'admin') {
    return res.status(403).send('Acesso negado. Apenas administradores podem acessar esta página.');
  }

  // Lista todos os usuários
  const users = db.prepare("SELECT id, email, name, role, created_at, last_login FROM users ORDER BY created_at DESC").all();
  
  res.render('admin', { users, error: null, success: null });
});

app.post("/admin/add-user", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const { email, name, role } = req.body;

  // Verifica se é admin
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  if (user?.role !== 'admin') {
    return res.status(403).send('Acesso negado.');
  }

  // Valida email
  if (!email || !email.includes('@')) {
    return res.render('admin', { 
      users: db.prepare("SELECT id, email, name, role, created_at, last_login FROM users ORDER BY created_at DESC").all(),
      error: 'Email inválido',
      success: null 
    });
  }

  try {
    // Insere novo usuário
    db.prepare("INSERT INTO users (email, name, role, created_at) VALUES (?, ?, ?, ?)")
      .run(email, name || email.split('@')[0], role || 'user', dayjs().toISOString());

    // Cria categorias padrão para o novo usuário
    const newUser = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    const categories = ['Prestação Apartamento', 'Luz', 'Internet', 'Condomínio', 'Tim'];
    const insertCat = db.prepare("INSERT OR IGNORE INTO finance_categories (user_id, name) VALUES (?, ?)");
    categories.forEach(cat => insertCat.run(newUser.id, cat));

    return res.render('admin', {
      users: db.prepare("SELECT id, email, name, role, created_at, last_login FROM users ORDER BY created_at DESC").all(),
      error: null,
      success: `Usuário ${email} adicionado com sucesso!`
    });
  } catch (err) {
    return res.render('admin', {
      users: db.prepare("SELECT id, email, name, role, created_at, last_login FROM users ORDER BY created_at DESC").all(),
      error: err.message,
      success: null
    });
  }
});

app.post("/admin/remove-user/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const targetUserId = req.params.id;

  // Verifica se é admin
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  if (user?.role !== 'admin') {
    return res.status(403).send('Acesso negado.');
  }

  // Não permite remover a si mesmo
  if (userId == targetUserId) {
    return res.render('admin', {
      users: db.prepare("SELECT id, email, name, role, created_at, last_login FROM users ORDER BY created_at DESC").all(),
      error: 'Você não pode remover sua própria conta',
      success: null
    });
  }

  try {
    // Remove todos os dados do usuário
    const tables = ['allocations', 'transactions', 'imports', 'person_payments', 'card_statements', 'people', 'cards', 'monthly_finances', 'scratchpad', 'finance_categories', 'closed_months'];
    
    for (const table of tables) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(targetUserId);
    }

    // Remove o usuário
    db.prepare("DELETE FROM users WHERE id = ?").run(targetUserId);

    return res.render('admin', {
      users: db.prepare("SELECT id, email, name, role, created_at, last_login FROM users ORDER BY created_at DESC").all(),
      error: null,
      success: 'Usuário removido com sucesso!'
    });
  } catch (err) {
    return res.render('admin', {
      users: db.prepare("SELECT id, email, name, role, created_at, last_login FROM users ORDER BY created_at DESC").all(),
      error: err.message,
      success: null
    });
  }
});

// ===== INICIAR SERVIDOR =====
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Rodando em http://localhost:${PORT}`);
});

module.exports = app;
