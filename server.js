require('dotenv').config(); // Carrega as variáveis do .env
const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require('axios');
const dayjs = require("dayjs");

let webPush = null;
try {
  webPush = require('web-push');
} catch (err) {
  webPush = null;
}

// Novas dependências para Auth
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const SQLiteStore = require('connect-sqlite3')(session);
const db = require("./src/db");

// --- EXECUTA MIGRAÇÃO AUTOMÁTICA AO INICIAR ---
require('./scripts/migrate.js');

// --- OPCIONAL: EXECUTA SEED AUTOMÁTICO (comentar se não quiser dados de exemplo) ---
// require('./scripts/seed.js');

// Migrações adicionais específicas

try { db.prepare("ALTER TABLE transactions ADD COLUMN due_month INTEGER").run(); } catch (e) { }
try { db.prepare("ALTER TABLE transactions ADD COLUMN due_year INTEGER").run(); } catch (e) { }
try { db.prepare("ALTER TABLE transactions ADD COLUMN parent_txn_id INTEGER").run(); } catch (e) { }
try { db.prepare("ALTER TABLE transactions ADD COLUMN recurring_rule_id INTEGER").run(); } catch (e) { }

// Adiciona a coluna de telefone na tabela people se ela não existir
try { db.prepare("ALTER TABLE people ADD COLUMN phone TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE people ADD COLUMN email TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE cards ADD COLUMN active INTEGER NOT NULL DEFAULT 1").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE cards ADD COLUMN close_day INTEGER").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE users ADD COLUMN can_import INTEGER NOT NULL DEFAULT 1").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN source_person_id INTEGER").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN source_txn_date_snapshot TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN payment_marked_at TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN payment_note TEXT").run(); } catch (e) { /* Coluna já existe */ }

// Cria a tabela de meses fechados se não existir
// Em ambiente multi-usuário, o fechamento precisa ser isolado por user_id.
db.prepare(`
  CREATE TABLE IF NOT EXISTS closed_months (
    user_id INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    PRIMARY KEY (user_id, month, year)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    subscription_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`).run();
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("ALTER TABLE closed_months ADD COLUMN user_id INTEGER").run(); } catch (e) { /* Coluna já existe ou tabela ainda não precisava de ajuste */ }
try { db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_closed_months_user_month_year ON closed_months(user_id, month, year)").run(); } catch (e) { /* Índice já existe */ }

db.prepare(`
  CREATE TABLE IF NOT EXISTS recurring_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    start_txn_date TEXT NOT NULL,
    start_due_month INTEGER NOT NULL,
    start_due_year INTEGER NOT NULL,
    active_from_month INTEGER NOT NULL,
    active_from_year INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    ended_at TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS recurring_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    rule_id INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, rule_id, month, year)
  )
`).run();

try { db.prepare("CREATE INDEX IF NOT EXISTS idx_txn_recurring_rule ON transactions(recurring_rule_id)").run(); } catch (e) { }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_recurring_rules_user_status ON recurring_rules(user_id, status)").run(); } catch (e) { }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_recurring_exceptions_user_rule_month ON recurring_exceptions(user_id, rule_id, year, month)").run(); } catch (e) { }

const { parseCsvByCardName } = require("./src/importers");
const { formatBRLFromCents, parseMonthYear, toISOFromBRDate, centsFromPtBrMoney } = require("./src/utils");
const formatDateBR = (dateStr) => { if (!dateStr) return "-"; return dayjs(dateStr).format("DD/MM/YYYY"); };
const { computeDueDate } = require("./src/dueDate");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PUSH_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const PUSH_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || '').trim();
const PUSH_SUBJECT = String(process.env.VAPID_SUBJECT || 'mailto:no-reply@organizapay.local').trim();
let pushRuntimeEnabled = false;

function isPushConfigured() {
  return pushRuntimeEnabled;
}

if (webPush && PUSH_PUBLIC_KEY && PUSH_PRIVATE_KEY) {
  try {
    webPush.setVapidDetails(PUSH_SUBJECT, PUSH_PUBLIC_KEY, PUSH_PRIVATE_KEY);
    pushRuntimeEnabled = true;
  } catch (err) {
    pushRuntimeEnabled = false;
    console.warn('⚠️  Push Web configurado de forma inválida. Verifique VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT.');
  }
} else if (PUSH_PUBLIC_KEY || PUSH_PRIVATE_KEY) {
  console.warn('⚠️  Push Web desativado: faltam dependência web-push ou variáveis VAPID completas.');
}

const DEFAULT_FINANCE_CATEGORIES = ['Prestação Apartamento', 'Luz', 'Internet', 'Condomínio', 'Tim'];

function getUserRecord(userId) {
  return db.prepare("SELECT id, email, name, role, can_import, created_at, last_login FROM users WHERE id = ?").get(userId);
}

function getAllUsers() {
  return db.prepare("SELECT id, email, name, role, can_import, created_at, last_login FROM users ORDER BY created_at DESC").all();
}

function isAdminUser(userId) {
  return getUserRecord(userId)?.role === 'admin';
}

function canUserImport(userId) {
  return Number(getUserRecord(userId)?.can_import ?? 1) !== 0;
}

function ensureDefaultOwnerPerson(userId, preferredName) {
  const safeName = String(preferredName || "").trim();
  if (!safeName) return;

  db.transaction(() => {
    const existingOwner = db.prepare("SELECT id FROM people WHERE user_id = ? AND is_owner = 1 LIMIT 1").get(userId);
    if (existingOwner) return;

    const existingPerson = db.prepare("SELECT id FROM people WHERE user_id = ? AND lower(name) = lower(?) LIMIT 1").get(userId, safeName);

    if (existingPerson) {
      db.prepare("UPDATE people SET active = 1 WHERE id = ? AND user_id = ?").run(existingPerson.id, userId);
      db.prepare("UPDATE people SET is_owner = 0 WHERE user_id = ?").run(userId);
      db.prepare("UPDATE people SET is_owner = 1 WHERE id = ? AND user_id = ?").run(existingPerson.id, userId);
      return;
    }

    db.prepare(`
      INSERT INTO people (user_id, name, phone, active, is_owner, created_at)
      VALUES (?, ?, NULL, 1, 1, ?)
    `).run(userId, safeName, dayjs().toISOString());
  })();
}

function renderAdmin(res, { error = null, success = null } = {}) {
  return res.render('admin', {
    title: 'OrganizaPay | Administração',
    users: getAllUsers(),
    error,
    success
  });
}

function setFlash(req, type, message) {
  if (!req.session) return;
  req.session.flash = { type, message };
}

// --- MIDDLEWARES DE BODY PARSER (DEVE VIR ANTES DAS ROTAS) ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// --- MIDDLEWARE DE LOGGING GLOBAL ---
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/txn/manual') {
  }
  next();
});

// --- CONFIGURAÇÃO DE SESSÃO E AUTH ---
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: './' }),
  secret: process.env.SESSION_SECRET || 'chave-secreta-padrao',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 dias
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

    const isFirstGoogleLogin = !authorizedUser.last_login;

    // Atualiza last_login
    db.prepare("UPDATE users SET last_login = ? WHERE email = ?").run(dayjs().toISOString(), email);

    if (isFirstGoogleLogin) {
      ensureDefaultOwnerPerson(authorizedUser.id, name || authorizedUser.name || email.split('@')[0]);
    }

    // Retorna o usuário
    return done(null, {
      id: authorizedUser.id,
      email,
      name: authorizedUser.name || name || email.split('@')[0],
      role: authorizedUser.role,
      can_import: Number(authorizedUser.can_import ?? 1)
    });
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

function ensureCanImport(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.redirect('/login');
  }

  if (Number(req.user?.can_import ?? 1) !== 0) {
    return next();
  }

  setFlash(req, 'error', 'Seu usuário não tem permissão para importar faturas.');
  return res.redirect(redirectBackOr(req, '/'));
}

// ===== ROTAS DE AUTH =====
app.get('/login', (req, res) => {
  res.render('login_oauth', { error: null });
});

app.get(['/privacy-policy', '/politica-de-privacidade'], (req, res) => {
  res.render('privacy-policy', {
    updatedAt: '14/03/2026'
  });
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

const handleGoogleCallback = passport.authenticate('google', {
  successRedirect: '/',
  failureRedirect: '/login?error=auth_failed'
});

app.get('/auth/google/callback', handleGoogleCallback);

// Compatibilidade com a rota antiga de callback.
app.get('/auth/callback', handleGoogleCallback);

// Compatibilidade com a rota antiga de login por POST.
app.post('/login', (req, res) => {
  res.redirect('/auth/google');
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).send('Erro ao fazer logout');
    req.session.destroy(() => {
      res.redirect('/login');
    });
  });
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// NOTA: Middlewares de body-parser já foram configurados no início do arquivo

app.use(express.static(path.join(__dirname, "public")));

// ===== MIDDLEWARE GLOBAL =====
app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.userId = null;
  res.locals.isAdmin = false;
  res.locals.canImport = false;
  res.locals.nomeTitular = "Detalhamento Contas";
  res.locals.formatDateBR = formatDateBR;
  res.locals.flash = req.session?.flash || null;
  res.locals.unreadNotificationCount = 0;
  res.locals.pushNotificationsEnabled = isPushConfigured();
  res.locals.pushPublicKey = isPushConfigured() ? PUSH_PUBLIC_KEY : '';
  const now = dayjs();
  res.locals.dashboardHref = `/detalhamento/${now.year()}/${now.month() + 1}`;

  if (req.session?.flash) {
    delete req.session.flash;
  }

  if (req.isAuthenticated() && req.user?.id) {
    res.locals.unreadNotificationCount = Number(getUnreadNotificationCount(req.user.id) || 0);
    const currentUser = getUserRecord(req.user.id);

    if (currentUser) {
      req.user.email = currentUser.email || req.user.email;
      req.user.name = currentUser.name || req.user.name || currentUser.email;
      req.user.role = currentUser.role;
      req.user.can_import = Number(currentUser.can_import ?? 1);
    }

    res.locals.user = req.user;
    res.locals.userId = req.user.id;
    res.locals.isAdmin = req.user.role === 'admin';
    res.locals.canImport = Number(req.user.can_import ?? 1) !== 0;

    try {
      const owner = db.prepare("SELECT name FROM people WHERE user_id = ? AND is_owner = 1 LIMIT 1").get(req.user.id);
      res.locals.nomeTitular = owner ? `Detalhamento ${owner.name}` : "Detalhamento Contas";
    } catch (e) {
      res.locals.nomeTitular = "Detalhamento Contas";
    }

    const dashboardTarget = getPreferredDashboardMonth(req.user.id);
    res.locals.dashboardHref = `/detalhamento/${dashboardTarget.year}/${dashboardTarget.month}`;
  }

  next();
});

function nowIso() { return dayjs().toISOString(); }

function normalizeDayNumber(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 31) return null;
  return num;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email || null;
}

function firstTwoNames(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(" ") || "Titular";
}

function monthLabel(month, year) {
  return `${String(month).padStart(2, "0")}/${year}`;
}

function monthKey(month, year) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function isMonthClosed(userId, month, year) {
  return !!db.prepare("SELECT 1 FROM closed_months WHERE user_id = ? AND month = ? AND year = ?").get(userId, month, year);
}

function getClosedMonthsSet(userId) {
  const rows = db.prepare("SELECT month, year FROM closed_months WHERE user_id = ?").all(userId);
  return new Set(rows.map(row => monthKey(row.month, row.year)));
}

function getMonthLockMessage(month, year) {
  return `O mês ${monthLabel(month, year)} está fechado para edição.`;
}

function redirectBackOr(req, fallback) {
  return req.get("referer") || fallback;
}

function getInstallmentMonths(startYear, startMonth, installments) {
  const months = [];
  let currentYear = Number(startYear);
  let currentMonth = Number(startMonth);

  for (let i = 0; i < installments; i++) {
    months.push({ year: currentYear, month: currentMonth, index: i + 1 });
    currentMonth += 1;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear += 1;
    }
  }

  return months;
}

function suggestFirstDueMonth(purchaseDate, closeDay, dueDay) {
  const purchase = dayjs(purchaseDate);
  if (!purchase.isValid()) return null;

  const normalizedCloseDay = normalizeDayNumber(closeDay);
  const normalizedDueDay = normalizeDayNumber(dueDay);
  let target = purchase.startOf("month");

  if (normalizedCloseDay && normalizedDueDay && normalizedCloseDay > normalizedDueDay) {
    target = target.add(1, "month");
  }

  if (normalizedCloseDay) {
    const effectiveCloseDay = Math.min(normalizedCloseDay, purchase.daysInMonth());
    if (purchase.date() >= effectiveCloseDay) {
      target = target.add(1, "month");
    }
  }

  return target.format("YYYY-MM");
}

function resolveFirstDueMonth({ firstDue, purchaseDate, closeDay, dueDay }) {
  const provided = String(firstDue || "").trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(provided)) return provided;
  return suggestFirstDueMonth(purchaseDate, closeDay, dueDay);
}

function shiftMonth(year, month, amount = 0) {
  let y = Number(year);
  let m = Number(month) + Number(amount || 0);

  while (m > 12) {
    m -= 12;
    y += 1;
  }

  while (m < 1) {
    m += 12;
    y -= 1;
  }

  return { year: y, month: m };
}

function compareMonthYear(aYear, aMonth, bYear, bMonth) {
  if (Number(aYear) !== Number(bYear)) return Number(aYear) - Number(bYear);
  return Number(aMonth) - Number(bMonth);
}
function getPreferredDashboardMonth(userId, startYear = dayjs().year(), startMonth = dayjs().month() + 1, maxLookahead = 24) {
  let current = { year: Number(startYear), month: Number(startMonth) };

  for (let i = 0; i <= maxLookahead; i += 1) {
    if (!isMonthClosed(userId, current.month, current.year)) {
      return current;
    }
    current = shiftMonth(current.year, current.month, 1);
  }

  return { year: Number(startYear), month: Number(startMonth) };
}


function occurrenceDateFromStart(startTxnDate, offset) {
  const base = dayjs(startTxnDate);
  if (!base.isValid()) return null;

  const shifted = shiftMonth(base.year(), base.month() + 1, offset);
  const firstDay = dayjs(`${shifted.year}-${String(shifted.month).padStart(2, '0')}-01`);
  const day = Math.min(base.date(), firstDay.daysInMonth());
  return `${shifted.year}-${String(shifted.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function csvEscape(value) {
  const str = String(value == null ? '' : value);
  if (/[";\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function getRecurringRules(userId, { includeEnded = false } = {}) {
  const whereEnded = includeEnded ? '' : "AND r.status != 'ended'";
  return db.prepare(`
    SELECT r.*, c.name AS card_name, c.close_day, c.due_day
    FROM recurring_rules r
    JOIN cards c ON c.id = r.card_id AND c.user_id = r.user_id
    WHERE r.user_id = ? ${whereEnded}
    ORDER BY CASE r.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, lower(r.description), r.id DESC
  `).all(userId);
}

function syncRecurringTransactions(userId, targetYear, targetMonth) {
  const year = Number(targetYear);
  const month = Number(targetMonth);
  if (!year || !month) return;

  const rules = db.prepare(`
    SELECT r.*, c.name AS card_name, COALESCE(c.active, 1) AS card_active
    FROM recurring_rules r
    JOIN cards c ON c.id = r.card_id AND c.user_id = r.user_id
    WHERE r.user_id = ? AND r.status = 'active' AND COALESCE(c.active, 1) = 1
    ORDER BY r.id
  `).all(userId);

  if (!rules.length) return;

  const activePeople = db.prepare("SELECT id FROM people WHERE user_id = ? AND active = 1 ORDER BY id").all(userId);
  const findTxn = db.prepare(`
    SELECT id
    FROM transactions
    WHERE user_id = ? AND recurring_rule_id = ? AND due_month = ? AND due_year = ?
    LIMIT 1
  `);
  const hasException = db.prepare(`
    SELECT 1
    FROM recurring_exceptions
    WHERE user_id = ? AND rule_id = ? AND month = ? AND year = ?
    LIMIT 1
  `);
  const insTxn = db.prepare(`
    INSERT INTO transactions (user_id, card_id, txn_date, description, amount_cents, due_month, due_year, recurring_rule_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insAlloc = db.prepare(`
    INSERT INTO allocations (user_id, transaction_id, person_id, share_cents, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    rules.forEach(rule => {
      if (compareMonthYear(rule.start_due_year, rule.start_due_month, year, month) > 0) return;

      let offset = 0;
      while (true) {
        const due = shiftMonth(rule.start_due_year, rule.start_due_month, offset);
        if (compareMonthYear(due.year, due.month, year, month) > 0) break;

        if (compareMonthYear(due.year, due.month, rule.active_from_year, rule.active_from_month) < 0) {
          offset += 1;
          continue;
        }

        if (hasException.get(userId, rule.id, due.month, due.year) || findTxn.get(userId, rule.id, due.month, due.year)) {
          offset += 1;
          continue;
        }

        if (isMonthClosed(userId, due.month, due.year)) {
          offset += 1;
          continue;
        }

        const txnDate = occurrenceDateFromStart(rule.start_txn_date, offset) || rule.start_txn_date;
        const info = insTxn.run(userId, rule.card_id, txnDate, rule.description, rule.amount_cents, due.month, due.year, rule.id, nowIso());

        if (activePeople.length === 1) {
          insAlloc.run(userId, info.lastInsertRowid, activePeople[0].id, rule.amount_cents, nowIso());
        }

        offset += 1;
      }
    });
  })();
}

function getRecurringPreview(rule) {
  const today = dayjs();
  const currentYear = today.year();
  const currentMonth = today.month() + 1;

  let offset = 0;
  while (offset < 240) {
    const due = shiftMonth(rule.start_due_year, rule.start_due_month, offset);
    if (compareMonthYear(due.year, due.month, rule.active_from_year, rule.active_from_month) < 0) {
      offset += 1;
      continue;
    }
    if (compareMonthYear(due.year, due.month, currentYear, currentMonth) >= 0) {
      return due;
    }
    offset += 1;
  }

  return null;
}

function removeFutureRecurringTransactions(userId, ruleId, fromYear, fromMonth) {
  const rows = db.prepare(`
    SELECT t.id, t.import_id
    FROM transactions t
    WHERE t.user_id = ?
      AND t.recurring_rule_id = ?
      AND (t.due_year > ? OR (t.due_year = ? AND t.due_month > ?))
  `).all(userId, ruleId, fromYear, fromYear, fromMonth);

  const removable = rows.filter(row => {
    const due = db.prepare("SELECT due_month, due_year FROM transactions WHERE id = ? AND user_id = ?").get(row.id, userId);
    return due && !isMonthClosed(userId, due.due_month, due.due_year);
  });

  if (removable.length) {
    deleteTransactionsAndAllocations(userId, removable);
  }
}

function getCards(userId) {
  return db.prepare(`
    SELECT id, name, due_day, close_day, holiday_scope, COALESCE(active, 1) AS active
    FROM cards
    WHERE user_id = ?
    ORDER BY COALESCE(active, 1) DESC, name
  `).all(userId);
}

function getActiveCards(userId) {
  return db.prepare(`
    SELECT id, name, due_day, close_day, holiday_scope, COALESCE(active, 1) AS active
    FROM cards
    WHERE user_id = ? AND COALESCE(active, 1) = 1
    ORDER BY name
  `).all(userId);
}

function getCardsByIds(userId, ids) {
  const uniqueIds = Array.from(new Set((ids || []).map(Number).filter(Boolean)));
  if (!uniqueIds.length) return [];

  const placeholders = uniqueIds.map(() => "?").join(", ");
  return db.prepare(`
    SELECT id, name, due_day, close_day, holiday_scope, COALESCE(active, 1) AS active
    FROM cards
    WHERE user_id = ? AND id IN (${placeholders})
    ORDER BY COALESCE(active, 1) DESC, name
  `).all(userId, ...uniqueIds);
}

function getPeopleAll(userId) {
  return db.prepare(`
    SELECT id, name, active, is_owner, phone, email
    FROM people
    WHERE user_id = ?
    ORDER BY is_owner DESC, active DESC, name
  `).all(userId);
}

function getPeopleActive(userId) {
  return db.prepare("SELECT id, name, active, email FROM people WHERE user_id = ? AND active = 1 ORDER BY name").all(userId);
}

function getPeopleByIds(userId, ids) {
  const uniqueIds = Array.from(new Set((ids || []).map(Number).filter(Boolean)));
  if (!uniqueIds.length) return [];

  const placeholders = uniqueIds.map(() => "?").join(", ");
  return db.prepare(`
    SELECT id, name, active, is_owner, phone, email
    FROM people
    WHERE user_id = ? AND id IN (${placeholders})
    ORDER BY active DESC, name
  `).all(userId, ...uniqueIds);
}

function getVisiblePeopleForMonth(userId, month, year, { includePayments = false } = {}) {
  const visibleIds = new Set(getPeopleActive(userId).map(person => person.id));

  const allocatedRows = db.prepare(`
    SELECT DISTINCT a.person_id
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND (
        (i.month = ? AND i.year = ?) OR
        (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
      )
  `).all(userId, month, year, month, year);

  allocatedRows.forEach(row => visibleIds.add(row.person_id));

  if (includePayments) {
    const paymentRows = db.prepare(`
      SELECT DISTINCT person_id
      FROM person_payments
      WHERE user_id = ? AND month = ? AND year = ?
    `).all(userId, month, year);

    paymentRows.forEach(row => visibleIds.add(row.person_id));
  }

  return getPeopleByIds(userId, Array.from(visibleIds));
}

function getVisiblePeopleForTransaction(userId, txnId) {
  const visibleIds = new Set(getPeopleActive(userId).map(person => person.id));
  const selectedRows = db.prepare(`
    SELECT DISTINCT person_id
    FROM allocations
    WHERE user_id = ? AND transaction_id = ?
  `).all(userId, txnId);

  selectedRows.forEach(row => visibleIds.add(row.person_id));

  return getPeopleByIds(userId, Array.from(visibleIds));
}

function getVisibleCardsForMonth(userId, month, year) {
  const visibleIds = new Set(getActiveCards(userId).map(card => card.id));

  const txnRows = db.prepare(`
    SELECT DISTINCT t.card_id
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (i.month = ? AND i.year = ?) OR
        (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
      )
  `).all(userId, month, year, month, year);

  txnRows.forEach(row => visibleIds.add(row.card_id));

  const statementRows = db.prepare(`
    SELECT DISTINCT card_id
    FROM card_statements
    WHERE user_id = ? AND month = ? AND year = ?
  `).all(userId, month, year);

  statementRows.forEach(row => visibleIds.add(row.card_id));

  return getCardsByIds(userId, Array.from(visibleIds));
}

function getOwnerPerson(userId) {
  return db.prepare("SELECT id, name FROM people WHERE user_id = ? AND is_owner = 1 LIMIT 1").get(userId);
}

function upsertPushSubscription(userId, subscription) {
  const endpoint = String(subscription?.endpoint || '').trim();
  if (!endpoint) return false;

  const serialized = JSON.stringify(subscription);
  const now = nowIso();

  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, subscription_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      subscription_json = excluded.subscription_json,
      updated_at = excluded.updated_at
  `).run(userId, endpoint, serialized, now, now);

  return true;
}

function removePushSubscriptionByEndpoint(endpoint) {
  const safeEndpoint = String(endpoint || '').trim();
  if (!safeEndpoint) return;

  db.prepare(`
    DELETE FROM push_subscriptions
    WHERE endpoint = ?
  `).run(safeEndpoint);
}

function removePushSubscriptionForUser(userId, endpoint) {
  const safeEndpoint = String(endpoint || '').trim();
  if (!safeEndpoint) return;

  db.prepare(`
    DELETE FROM push_subscriptions
    WHERE endpoint = ? AND user_id = ?
  `).run(safeEndpoint, userId);
}

function getPushSubscriptionsForUser(userId) {
  return db.prepare(`
    SELECT endpoint, subscription_json
    FROM push_subscriptions
    WHERE user_id = ?
    ORDER BY id DESC
  `).all(userId);
}

async function sendPushNotificationToUser(userId, payload) {
  if (!isPushConfigured()) return;

  const subscriptions = getPushSubscriptionsForUser(userId);
  if (!subscriptions.length) return;

  const message = JSON.stringify({
    title: String(payload?.title || 'OrganizaPay'),
    body: payload?.body ? String(payload.body) : '',
    href: payload?.href ? String(payload.href) : '/shared-debts',
    tag: payload?.tag ? String(payload.tag) : undefined
  });

  await Promise.allSettled(subscriptions.map(async (row) => {
    try {
      const parsedSubscription = JSON.parse(row.subscription_json);
      await webPush.sendNotification(parsedSubscription, message);
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        removePushSubscriptionByEndpoint(row.endpoint);
        return;
      }

      console.error('Erro ao enviar push notification:', err?.message || err);
    }
  }));
}

function queuePushNotification(userId, payload) {
  if (!isPushConfigured()) return;

  Promise.resolve()
    .then(() => sendPushNotificationToUser(userId, payload))
    .catch(err => console.error('Falha ao disparar push notification:', err?.message || err));
}

function createNotification({ userId, type, title, body = null, href = null, relatedType = null, relatedId = null }) {
  const result = db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, href, is_read, related_type, related_id, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(userId, type, title, body, href, relatedType, relatedId, nowIso());

  const pushTag = relatedType && relatedId ? `${relatedType}:${relatedId}` : `${type}:${result.lastInsertRowid || nowIso()}`;
  queuePushNotification(userId, { title, body, href, tag: pushTag });

  return result;
}

function getUnreadNotificationCount(userId) {
  return db.prepare(`
    SELECT COUNT(*) AS total
    FROM notifications
    WHERE user_id = ? AND is_read = 0
  `).get(userId)?.total || 0;
}

function getNotificationsForUser(userId) {
  return db.prepare(`
    SELECT *
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(userId);
}

function getNotificationForUser(notificationId, userId) {
  return db.prepare(`
    SELECT *
    FROM notifications
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `).get(notificationId, userId);
}

function markNotificationAsRead(notificationId, userId) {
  return db.prepare(`
    UPDATE notifications
    SET is_read = 1, read_at = COALESCE(read_at, ?)
    WHERE id = ? AND user_id = ? AND is_read = 0
  `).run(nowIso(), notificationId, userId);
}

function markAllNotificationsAsRead(userId) {
  return db.prepare(`
    UPDATE notifications
    SET is_read = 1, read_at = COALESCE(read_at, ?)
    WHERE user_id = ? AND is_read = 0
  `).run(nowIso(), userId);
}

function addSharedDebtEvent({ requestId, actorUserId, eventType, note = null }) {
  db.prepare(`
    INSERT INTO shared_debt_events (request_id, actor_user_id, event_type, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(requestId, actorUserId, eventType, note, nowIso());
}

function clearSharedDebtAllocationLinksForTransaction(userId, txnId) {
  db.prepare(`
    UPDATE shared_debt_requests
    SET source_allocation_id = NULL,
        updated_at = ?
    WHERE requester_user_id = ?
      AND source_transaction_id = ?
      AND source_allocation_id IS NOT NULL
  `).run(nowIso(), userId, txnId);
}

function detachSharedDebtRequestsFromDeletedTransaction(userId, txnId) {
  const now = nowIso();
  const pendingRows = db.prepare(`
    SELECT id
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND source_transaction_id = ?
      AND status = 'pending'
  `).all(userId, txnId);

  pendingRows.forEach(row => {
    db.prepare(`
      UPDATE shared_debt_requests
      SET status = 'cancelled',
          updated_at = ?,
          resolved_at = COALESCE(resolved_at, ?)
      WHERE id = ? AND status = 'pending'
    `).run(now, now, row.id);

    addSharedDebtEvent({
      requestId: row.id,
      actorUserId: userId,
      eventType: 'cancelled',
      note: 'Solicitação cancelada automaticamente porque o lançamento original foi excluído.'
    });
  });

  db.prepare(`
    UPDATE shared_debt_requests
    SET source_transaction_id = NULL,
        source_allocation_id = NULL,
        card_id = NULL,
        updated_at = ?
    WHERE requester_user_id = ?
      AND source_transaction_id = ?
  `).run(now, userId, txnId);
}

function cancelPendingSharedDebtRequestsForTransaction(userId, txnId, note = 'Lançamento removido ou deixou de ser elegível para compartilhamento.') {
  const pendingRows = db.prepare(`
    SELECT id
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND source_transaction_id = ?
      AND status = 'pending'
  `).all(userId, txnId);

  if (!pendingRows.length) return;

  const now = nowIso();
  const updateStmt = db.prepare(`
    UPDATE shared_debt_requests
    SET status = 'cancelled', updated_at = ?, resolved_at = ?
    WHERE id = ? AND status = 'pending'
  `);

  pendingRows.forEach(row => {
    updateStmt.run(now, now, row.id);
    addSharedDebtEvent({ requestId: row.id, actorUserId: userId, eventType: 'cancelled', note });
  });
}

function syncSharedDebtRequestsForTransaction(userId, txnId) {
  const txn = db.prepare(`
    SELECT
      t.id,
      t.txn_date,
      t.description,
      t.amount_cents,
      t.card_id,
      c.name AS card_name,
      COALESCE(i.month, t.due_month) AS due_month,
      COALESCE(i.year, t.due_year) AS due_year
    FROM transactions t
    LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.id = ? AND t.user_id = ?
  `).get(txnId, userId);

  if (!txn) {
    cancelPendingSharedDebtRequestsForTransaction(userId, txnId);
    return;
  }

  const requesterPerson = getOwnerPerson(userId);
  const requesterDisplayName = requesterPerson?.name || getUserRecord(userId)?.name || 'Um usuário';

  const eligibleRows = db.prepare(`
    SELECT
      a.id AS allocation_id,
      a.person_id,
      a.share_cents,
      p.name AS person_name,
      p.email AS person_email,
      u.id AS receiver_user_id,
      u.name AS receiver_user_name,
      u.email AS receiver_user_email
    FROM allocations a
    JOIN people p ON p.id = a.person_id AND p.user_id = a.user_id
    JOIN users u ON lower(u.email) = lower(p.email)
    WHERE a.user_id = ?
      AND a.transaction_id = ?
      AND p.email IS NOT NULL
      AND trim(p.email) <> ''
      AND u.id <> ?
      AND a.share_cents > 0
    ORDER BY a.id
  `).all(userId, txnId, userId);

  const existingRequests = db.prepare(`
    SELECT *
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND source_transaction_id = ?
    ORDER BY id DESC
  `).all(userId, txnId);

  const existingPending = existingRequests.filter(row => row.status === 'pending');

  const existingByPerson = new Map();
  const latestByPerson = new Map();

  existingRequests.forEach(row => {
    const personId = Number(row.source_person_id || 0);
    if (!personId) return;
    if (!latestByPerson.has(personId)) latestByPerson.set(personId, row);
    if (row.status === 'pending' && !existingByPerson.has(personId)) {
      existingByPerson.set(personId, row);
    }
  });

  const activePersonIds = new Set();
  const now = nowIso();

  db.transaction(() => {
    eligibleRows.forEach(row => {
      const personId = Number(row.person_id);
      activePersonIds.add(personId);

      const receiverEmailSnapshot = normalizeEmail(row.person_email || row.receiver_user_email);
      const receiverNameSnapshot = row.person_name || row.receiver_user_name || null;
      const existing = existingByPerson.get(personId);

      if (existing) {
        const changed = [
          Number(existing.receiver_user_id || 0) !== Number(row.receiver_user_id || 0),
          Number(existing.amount_cents || 0) !== Number(row.share_cents || 0),
          Number(existing.card_id || 0) !== Number(txn.card_id || 0),
          String(existing.card_name_snapshot || '') !== String(txn.card_name || ''),
          String(existing.description_snapshot || '') !== String(txn.description || ''),
          Number(existing.source_due_month || 0) !== Number(txn.due_month || 0),
          Number(existing.source_due_year || 0) !== Number(txn.due_year || 0),
          String(existing.source_txn_date_snapshot || '') !== String(txn.txn_date || ''),
          String(existing.receiver_email_snapshot || '') !== String(receiverEmailSnapshot || ''),
          String(existing.receiver_name_snapshot || '') !== String(receiverNameSnapshot || '')
        ].some(Boolean);

        db.prepare(`
          UPDATE shared_debt_requests
          SET requester_person_id = ?,
              receiver_user_id = ?,
              source_person_id = ?,
              source_allocation_id = ?,
              source_due_month = ?,
              source_due_year = ?,
              source_txn_date_snapshot = ?,
              card_id = ?,
              card_name_snapshot = ?,
              description_snapshot = ?,
              amount_cents = ?,
              receiver_email_snapshot = ?,
              receiver_name_snapshot = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          requesterPerson?.id || null,
          row.receiver_user_id,
          personId,
          row.allocation_id,
          txn.due_month || null,
          txn.due_year || null,
          txn.txn_date || null,
          txn.card_id || null,
          txn.card_name || null,
          txn.description,
          row.share_cents,
          receiverEmailSnapshot,
          receiverNameSnapshot,
          now,
          existing.id
        );

        if (changed) {
          addSharedDebtEvent({
            requestId: existing.id,
            actorUserId: userId,
            eventType: 'updated',
            note: 'Solicitação atualizada automaticamente após alteração na distribuição.'
          });

          createNotification({
            userId: row.receiver_user_id,
            type: 'shared_debt_request',
            title: 'Cobrança compartilhada atualizada',
            body: `${requesterDisplayName} atualizou uma cobrança para ${formatBRLFromCents(row.share_cents)} referente a ${txn.description}.`,
            href: `/shared-debts?request=${existing.id}`,
            relatedType: 'shared_debt_request',
            relatedId: existing.id
          });
        }
      } else {
        const latestRequest = latestByPerson.get(personId);
        const hasActiveHistory = latestRequest && latestRequest.status && latestRequest.status !== 'cancelled';

        if (!hasActiveHistory) {
          const info = db.prepare(`
            INSERT INTO shared_debt_requests (
              requester_user_id, requester_person_id, receiver_user_id, source_person_id,
              source_transaction_id, source_allocation_id, source_due_month, source_due_year, source_txn_date_snapshot,
              card_id, card_name_snapshot, description_snapshot, amount_cents,
              receiver_email_snapshot, receiver_name_snapshot, request_note, response_note,
              status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', ?, ?)
          `).run(
            userId,
            requesterPerson?.id || null,
            row.receiver_user_id,
            personId,
            txnId,
            row.allocation_id,
            txn.due_month || null,
            txn.due_year || null,
            txn.txn_date || null,
            txn.card_id || null,
            txn.card_name || null,
            txn.description,
            row.share_cents,
            receiverEmailSnapshot,
            receiverNameSnapshot,
            now,
            now
          );

          const requestId = Number(info.lastInsertRowid);
          addSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'created' });

          createNotification({
            userId: row.receiver_user_id,
            type: 'shared_debt_request',
            title: 'Nova cobrança compartilhada',
            body: `${requesterDisplayName} enviou uma cobrança para você no valor de ${formatBRLFromCents(row.share_cents)} referente a ${txn.description}.`,
            href: `/shared-debts?request=${requestId}`,
            relatedType: 'shared_debt_request',
            relatedId: requestId
          });
        }
      }
    });

    existingPending.forEach(row => {
      const personId = Number(row.source_person_id || 0);
      if (personId && !activePersonIds.has(personId)) {
        db.prepare(`
          UPDATE shared_debt_requests
          SET status = 'cancelled', updated_at = ?, resolved_at = ?
          WHERE id = ? AND status = 'pending'
        `).run(now, now, row.id);

        addSharedDebtEvent({
          requestId: row.id,
          actorUserId: userId,
          eventType: 'cancelled',
          note: 'Solicitação cancelada automaticamente porque a pessoa deixou de participar da divisão.'
        });
      }
    });
  })();
}

function deleteTransactionsAndAllocations(userId, rows) {
  const uniqueRows = Array.from(new Map(
    (rows || [])
      .map(row => ({ id: Number(row.id), import_id: row.import_id ? Number(row.import_id) : null }))
      .filter(row => row.id)
      .map(row => [row.id, row])
  ).values());

  if (!uniqueRows.length) return 0;

  const deleteAllocation = db.prepare("DELETE FROM allocations WHERE transaction_id = ? AND user_id = ?");
  const deleteTransaction = db.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?");
  const deleteImportIfEmpty = db.prepare(`
    DELETE FROM imports
    WHERE id = ? AND user_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.import_id = imports.id AND t.user_id = imports.user_id
      )
  `);

  db.transaction((items) => {
    const importIds = new Set();

    items.forEach(item => {
      detachSharedDebtRequestsFromDeletedTransaction(userId, item.id);
      deleteAllocation.run(item.id, userId);
      deleteTransaction.run(item.id, userId);
      if (item.import_id) importIds.add(item.import_id);
    });

    importIds.forEach(importId => deleteImportIfEmpty.run(importId, userId));
  })(uniqueRows);

  return uniqueRows.length;
}

function getTransactionScopeRow(userId, txnId) {
  return db.prepare(`
    SELECT t.id, t.import_id, t.description, t.amount_cents, t.card_id, t.recurring_rule_id, t.parent_txn_id,
           COALESCE(i.month, t.due_month) AS month,
           COALESCE(i.year, t.due_year) AS year
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.id = ? AND t.user_id = ?
  `).get(txnId, userId);
}

function hasFutureInstallments(userId, txnRow) {
  if (!txnRow) return false;
  const currentMonth = Number(txnRow.month || 0);
  const currentYear = Number(txnRow.year || 0);
  const rootId = Number(txnRow.parent_txn_id || txnRow.id || 0);
  if (!rootId || !currentMonth || !currentYear) return false;

  return !!db.prepare(`
    SELECT 1
    FROM transactions t
    WHERE t.user_id = ?
      AND (t.id = ? OR t.parent_txn_id = ?)
      AND t.due_year IS NOT NULL
      AND t.due_month IS NOT NULL
      AND (
        t.due_year > ? OR
        (t.due_year = ? AND t.due_month > ?)
      )
    LIMIT 1
  `).get(userId, rootId, rootId, currentYear, currentYear, currentMonth);
}

function getInstallmentScopeRows(userId, txnRow, scope = 'single') {
  if (!txnRow) return [];

  const normalizedScope = String(scope || 'single').trim().toLowerCase();
  if (normalizedScope !== 'future') {
    return [txnRow];
  }

  const currentMonth = Number(txnRow.month || 0);
  const currentYear = Number(txnRow.year || 0);
  const rootId = Number(txnRow.parent_txn_id || txnRow.id || 0);
  if (!rootId || !currentMonth || !currentYear) {
    return [txnRow];
  }

  const rows = db.prepare(`
    SELECT t.id, t.import_id, t.description, t.amount_cents, t.card_id, t.recurring_rule_id, t.parent_txn_id,
           COALESCE(i.month, t.due_month) AS month,
           COALESCE(i.year, t.due_year) AS year
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (t.id = ? OR t.parent_txn_id = ?)
      AND (
        COALESCE(i.year, t.due_year) > ? OR
        (COALESCE(i.year, t.due_year) = ? AND COALESCE(i.month, t.due_month) >= ?)
      )
    ORDER BY COALESCE(i.year, t.due_year) ASC, COALESCE(i.month, t.due_month) ASC, t.id ASC
  `).all(userId, rootId, rootId, currentYear, currentYear, currentMonth);

  return rows.length ? rows : [txnRow];
}

function likeParam(s) { return `%${String(s).trim()}%`; }

app.get("/", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;

  // Verifica se existe um titular cadastrado para o usuário logado
  const owner = db.prepare("SELECT id FROM people WHERE user_id = ? AND is_owner = 1 LIMIT 1").get(userId);

  // Se não houver titular, redireciona para a página de Pessoas para criar um
  if (!owner) {
    return res.redirect('/people');
  }

  const target = getPreferredDashboardMonth(userId);
  res.redirect(`/detalhamento/${target.year}/${target.month}`);
});

app.get("/geral", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const now = dayjs();
  const nextReference = shiftMonth(now.year(), now.month() + 1, 1);
  syncRecurringTransactions(userId, nextReference.year, nextReference.month);

  // 1. Puxamos todas as importações e transações manuais do usuário logado
  const recent = db.prepare(`
    SELECT i.id, i.month, i.year, i.created_at, i.original_filename, c.name AS card_name, c.id AS card_id,
           (SELECT COUNT(*) FROM transactions t WHERE t.import_id = i.id AND t.user_id = i.user_id) AS txn_count,
           (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions t WHERE t.import_id = i.id AND t.user_id = i.user_id) AS import_total
    FROM imports i
    JOIN cards c ON c.id = i.card_id AND c.user_id = i.user_id
    WHERE i.user_id = ?

    UNION ALL

    SELECT NULL as id, t.due_month as month, t.due_year as year, t.created_at, 'Manual' as original_filename,
           c.name AS card_name, c.id AS card_id,
           1 AS txn_count,
           t.amount_cents AS import_total
    FROM transactions t
    JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    WHERE t.user_id = ? AND t.import_id IS NULL

    ORDER BY year DESC, month DESC, id DESC
  `).all(userId, userId);

  // 2. Puxamos o que já foi marcado como pago na tela de Resumo
  const statementsRows = db.prepare("SELECT card_id, month, year, paid_cents FROM card_statements WHERE user_id = ?").all(userId);
  const statements = {};
  const closedMonths = getClosedMonthsSet(userId);
  statementsRows.forEach(s => {
    statements[`${s.year}-${s.month}-${s.card_id}`] = s.paid_cents || 0;
  });

  // 3. Agrupamos por mês/ano e consolidamos os cartões dentro de cada mês
  const groupedMap = new Map();

  recent.forEach(r => {
    const monthKey = `${r.year}-${r.month}`;

    if (!groupedMap.has(monthKey)) {
      groupedMap.set(monthKey, {
        year: r.year,
        month: r.month,
        label: `${String(r.month).padStart(2, '0')}/${r.year}`,
        cards: [],
        total_cents: 0,
        paid_cents: 0,
        remaining_cents: 0,
        cardsMap: new Map()
      });
    }

    const group = groupedMap.get(monthKey);
    group.total_cents += r.import_total;

    if (!group.cardsMap.has(r.card_id)) {
      group.cardsMap.set(r.card_id, {
        card_id: r.card_id,
        card_name: r.card_name,
        month: r.month,
        year: r.year,
        txn_count: 0,
        import_total: 0,
        original_filename: r.original_filename,
        filenames: new Set()
      });
    }

    const cardGroup = group.cardsMap.get(r.card_id);
    cardGroup.txn_count += r.txn_count;
    cardGroup.import_total += r.import_total;

    if (r.original_filename) {
      cardGroup.filenames.add(r.original_filename);
    }
  });

  const groupedRecent = Array.from(groupedMap.values()).map(group => {
    const cards = Array.from(group.cardsMap.values())
      .map(card => {
        const filenames = Array.from(card.filenames.values());
        return {
          card_id: card.card_id,
          card_name: card.card_name,
          month: card.month,
          year: card.year,
          txn_count: card.txn_count,
          import_total: card.import_total,
          original_filename: filenames.length > 1 ? filenames.join(' + ') : (filenames[0] || 'N/A')
        };
      })
      .sort((a, b) => a.card_name.localeCompare(b.card_name, 'pt-BR', { sensitivity: 'base' }));

    const paid_cents = cards.reduce((totalPaid, card) => {
      return totalPaid + (statements[`${group.year}-${group.month}-${card.card_id}`] || 0);
    }, 0);

    return {
      year: group.year,
      month: group.month,
      label: group.label,
      cards,
      total_cents: group.total_cents,
      paid_cents,
      remaining_cents: Math.max(0, group.total_cents - paid_cents),
      isClosed: closedMonths.has(monthKey(group.month, group.year))
    };
  });

  const sortDesc = (a, b) => (b.year !== a.year) ? b.year - a.year : b.month - a.month;
  const sortAsc = (a, b) => (a.year !== b.year) ? a.year - b.year : a.month - b.month;

  const nowDate = new Date();
  const currentYear = nowDate.getFullYear();
  const currentMonth = nowDate.getMonth() + 1;
  const preferredOpenMonth = getPreferredDashboardMonth(userId, currentYear, currentMonth);

  const openGroups = groupedRecent
    .filter(group => !group.isClosed)
    .sort(sortAsc);
  const closedGroups = groupedRecent
    .filter(group => group.isClosed)
    .sort(sortDesc);

  const featuredOpenGroup = openGroups.find(group => group.year === preferredOpenMonth.year && group.month === preferredOpenMonth.month)
    || openGroups[0]
    || null;

  const remainingOpenGroups = featuredOpenGroup
    ? openGroups.filter(group => !(group.year === featuredOpenGroup.year && group.month === featuredOpenGroup.month))
      .sort((a, b) => {
        const aIsFuture = compareMonthYear(a.year, a.month, featuredOpenGroup.year, featuredOpenGroup.month) >= 0;
        const bIsFuture = compareMonthYear(b.year, b.month, featuredOpenGroup.year, featuredOpenGroup.month) >= 0;
        if (aIsFuture !== bIsFuture) return aIsFuture ? -1 : 1;
        return aIsFuture ? sortAsc(a, b) : sortDesc(a, b);
      })
    : [];

  const groupedRecentDisplay = [];
  if (featuredOpenGroup) {
    groupedRecentDisplay.push(featuredOpenGroup);
  }
  if (remainingOpenGroups.length) {
    groupedRecentDisplay.push({ __section: true, kind: 'open', label: 'Próximos meses em aberto', description: 'Competências abertas em ordem crescente.' });
    groupedRecentDisplay.push(...remainingOpenGroups);
  }
  if (closedGroups.length) {
    groupedRecentDisplay.push({ __section: true, kind: 'closed', label: 'Meses fechados', description: 'Competências encerradas, listadas em ordem decrescente.' });
    groupedRecentDisplay.push(...closedGroups);
  }

  const cards = getActiveCards(userId).map(({ id, name, close_day, due_day }) => ({ id, name, close_day, due_day }));

  res.render("home", {
    groupedRecent: groupedRecentDisplay,
    featuredOpenGroup,
    formatBRLFromCents,
    cards,
    closedMonths: Array.from(closedMonths.values()),
    user: req.user || req.session.user
  });
});

app.post("/geral/:year/:month/card/:cardId/delete", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const cardId = Number(req.params.cardId);

  if (!cardId || !month || month < 1 || month > 12 || !year) {
    setFlash(req, "error", "Parâmetros inválidos para excluir os lançamentos do cartão.");
    return res.redirect("/geral");
  }

  const card = db.prepare("SELECT id, name FROM cards WHERE id = ? AND user_id = ?").get(cardId, userId);
  if (isMonthClosed(userId, month, year)) {
    setFlash(req, "error", getMonthLockMessage(month, year));
    return res.redirect("/geral");
  }
  if (!card) {
    setFlash(req, "error", "Cartão não encontrado.");
    return res.redirect("/geral");
  }

  const txns = db.prepare(`
    SELECT t.id, t.import_id, t.recurring_rule_id, t.due_month, t.due_year
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND t.card_id = ?
      AND (
        (i.month = ? AND i.year = ?) OR
        (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
      )
  `).all(userId, cardId, month, year, month, year);

  if (!txns.length) {
    setFlash(req, "info", `Nenhum lançamento foi encontrado para ${card.name} em ${String(month).padStart(2, "0")}/${year}.`);
    return res.redirect("/geral");
  }

  const addException = db.prepare(`
    INSERT OR IGNORE INTO recurring_exceptions (user_id, rule_id, month, year, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  let deletedCount = 0;
  db.transaction(() => {
    txns.forEach(txn => {
      if (txn.recurring_rule_id && txn.due_month && txn.due_year) {
        addException.run(userId, txn.recurring_rule_id, txn.due_month, txn.due_year, nowIso());
      }
    });
    deletedCount = deleteTransactionsAndAllocations(userId, txns);
  })();

  setFlash(req, "success", `${deletedCount} lançamento(s) de ${card.name} em ${String(month).padStart(2, "0")}/${year} foram excluídos.`);
  return res.redirect("/geral");
});

app.get("/geral/:year/:month/export.csv", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;

  syncRecurringTransactions(userId, year, month);

  const rows = db.prepare(`
    SELECT
      COALESCE(t.txn_date, '') AS txn_date,
      t.description,
      c.name AS card_name,
      COALESCE(t.card_number, '') AS card_number,
      t.amount_cents,
      CASE WHEN EXISTS (
        SELECT 1 FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id
      ) THEN 'Sim' ELSE 'Não' END AS allocated,
      COALESCE((
        SELECT GROUP_CONCAT(name, ', ') FROM (
          SELECT p.name AS name
          FROM allocations a2
          JOIN people p ON p.id = a2.person_id AND p.user_id = a2.user_id
          WHERE a2.transaction_id = t.id AND a2.user_id = t.user_id
          ORDER BY p.name
        )
      ), '') AS people_names,
      CASE WHEN t.import_id IS NULL THEN 'Manual' ELSE COALESCE(i.original_filename, 'Importado') END AS origem
    FROM transactions t
    JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (i.month = ? AND i.year = ?) OR
        (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
      )
    ORDER BY c.name, COALESCE(t.txn_date, ''), t.description
  `).all(userId, month, year, month, year);

  const header = ['Data da compra', 'Descrição', 'Cartão', 'Número', 'Valor (R$)', 'Distribuído', 'Pessoas', 'Origem', 'Competência'];
  const lines = [header.map(csvEscape).join(';')];

  rows.forEach(row => {
    lines.push([
      formatDateBR(row.txn_date),
      row.description,
      row.card_name,
      row.card_number,
      formatBRLFromCents(row.amount_cents),
      row.allocated,
      row.people_names,
      row.origem,
      monthLabel(month, year)
    ].map(csvEscape).join(';'));
  });

  const filename = `organizapay-cartoes-${year}-${String(month).padStart(2, '0')}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + lines.join('\r\n'));
});

function getSharedDebtRequestsReceived(userId) {
  return db.prepare(`
    SELECT
      r.*,
      u.name AS requester_name,
      u.email AS requester_email,
      COALESCE(r.source_txn_date_snapshot, t.txn_date) AS source_txn_date
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.requester_user_id
    LEFT JOIN transactions t ON t.id = r.source_transaction_id AND t.user_id = r.requester_user_id
    WHERE r.receiver_user_id = ?
    ORDER BY
      COALESCE(r.source_due_year, 0) DESC,
      COALESCE(r.source_due_month, 0) DESC,
      CASE r.status
        WHEN 'pending' THEN 0
        WHEN 'accepted' THEN 1
        WHEN 'rejected_by_receiver' THEN 2
        WHEN 'rejection_contested_by_sender' THEN 3
        WHEN 'rejection_accepted_by_sender' THEN 4
        WHEN 'cancelled' THEN 5
        WHEN 'settled' THEN 6
        ELSE 7
      END,
      COALESCE(r.source_txn_date_snapshot, t.txn_date, r.created_at) DESC,
      r.created_at DESC
  `).all(userId);
}

function getSharedDebtRequestsSent(userId) {
  return db.prepare(`
    SELECT
      r.*,
      u.name AS receiver_name,
      u.email AS receiver_email,
      COALESCE(r.source_txn_date_snapshot, t.txn_date) AS source_txn_date
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.receiver_user_id
    LEFT JOIN transactions t ON t.id = r.source_transaction_id AND t.user_id = r.requester_user_id
    WHERE r.requester_user_id = ?
    ORDER BY
      COALESCE(r.source_due_year, 0) DESC,
      COALESCE(r.source_due_month, 0) DESC,
      CASE r.status
        WHEN 'pending' THEN 0
        WHEN 'accepted' THEN 1
        WHEN 'rejected_by_receiver' THEN 2
        WHEN 'rejection_contested_by_sender' THEN 3
        WHEN 'rejection_accepted_by_sender' THEN 4
        WHEN 'cancelled' THEN 5
        WHEN 'settled' THEN 6
        ELSE 7
      END,
      COALESCE(r.source_txn_date_snapshot, t.txn_date, r.created_at) DESC,
      r.created_at DESC
  `).all(userId);
}

function getSharedDebtEventsByRequestIds(requestIds) {
  const cleanIds = Array.from(new Set((requestIds || []).map(Number).filter(Boolean)));
  if (!cleanIds.length) return new Map();

  const placeholders = cleanIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT e.*, u.name AS actor_name, u.email AS actor_email
    FROM shared_debt_events e
    JOIN users u ON u.id = e.actor_user_id
    WHERE e.request_id IN (${placeholders})
    ORDER BY e.created_at ASC, e.id ASC
  `).all(...cleanIds);

  const map = new Map();
  rows.forEach(row => {
    if (!map.has(row.request_id)) map.set(row.request_id, []);
    map.get(row.request_id).push(row);
  });
  return map;
}

function getAcceptedSharedDebtSummaryForMonth(userId, month, year) {
  const owed = db.prepare(`
    SELECT COUNT(*) AS total_requests, COALESCE(SUM(r.amount_cents), 0) AS total_cents
    FROM shared_debt_requests r
    LEFT JOIN transactions t ON t.id = r.source_transaction_id AND t.user_id = r.requester_user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE r.receiver_user_id = ?
      AND r.status = 'accepted'
      AND COALESCE(r.source_due_month, i.month, t.due_month) = ?
      AND COALESCE(r.source_due_year, i.year, t.due_year) = ?
  `).get(userId, month, year) || { total_requests: 0, total_cents: 0 };

  const receivable = db.prepare(`
    SELECT COUNT(*) AS total_requests, COALESCE(SUM(r.amount_cents), 0) AS total_cents
    FROM shared_debt_requests r
    LEFT JOIN transactions t ON t.id = r.source_transaction_id AND t.user_id = r.requester_user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE r.requester_user_id = ?
      AND r.status = 'accepted'
      AND COALESCE(r.source_due_month, i.month, t.due_month) = ?
      AND COALESCE(r.source_due_year, i.year, t.due_year) = ?
  `).get(userId, month, year) || { total_requests: 0, total_cents: 0 };

  return {
    owedCents: Number(owed.total_cents || 0),
    owedCount: Number(owed.total_requests || 0),
    receivableCents: Number(receivable.total_cents || 0),
    receivableCount: Number(receivable.total_requests || 0)
  };
}

app.get("/shared-debts", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestIdToHighlight = Number(req.query.request) || null;

  db.prepare(`
    UPDATE notifications
    SET is_read = 1, read_at = COALESCE(read_at, ?)
    WHERE user_id = ?
      AND (related_type = 'shared_debt_request' OR type = 'shared_debt_request')
      AND is_read = 0
  `).run(nowIso(), userId);

  const received = getSharedDebtRequestsReceived(userId);
  const sent = getSharedDebtRequestsSent(userId);
  const eventsByRequest = getSharedDebtEventsByRequestIds([
    ...received.map(item => item.id),
    ...sent.map(item => item.id)
  ]);

  return res.render("shared-debts", {
    title: "OrganizaPay | Dívidas Compartilhadas",
    received,
    sent,
    eventsByRequest,
    requestIdToHighlight,
    formatBRLFromCents,
    monthLabel,
    formatDateBR
  });
});

app.post("/shared-debts/:id/respond", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestId = Number(req.params.id);
  const action = String(req.body.action || '').trim().toLowerCase();
  const note = String(req.body.note || '').trim() || null;

  if (!requestId) {
    setFlash(req, 'error', 'Solicitação inválida.');
    return res.redirect('/shared-debts');
  }

  if (!['accept', 'reject'].includes(action)) {
    setFlash(req, 'error', 'Ação inválida para esta solicitação.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  const requestRow = db.prepare(`
    SELECT r.*, u.name AS requester_name, u.email AS requester_email
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.requester_user_id
    WHERE r.id = ? AND r.receiver_user_id = ?
    LIMIT 1
  `).get(requestId, userId);

  if (!requestRow) {
    setFlash(req, 'error', 'Solicitação não encontrada.');
    return res.redirect('/shared-debts');
  }

  if (requestRow.status !== 'pending') {
    setFlash(req, 'info', 'Esta solicitação já foi analisada anteriormente.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || requestRow.receiver_name_snapshot || actor?.email || 'O destinatário';
  const now = nowIso();
  const accepted = action === 'accept';
  const nextStatus = accepted ? 'accepted' : 'rejected_by_receiver';
  const eventType = nextStatus;
  const title = accepted ? 'Cobrança compartilhada aceita' : 'Cobrança compartilhada recusada';
  const baseBody = accepted
    ? `${actorName} aceitou a cobrança de ${formatBRLFromCents(requestRow.amount_cents)} referente a ${requestRow.description_snapshot}.`
    : `${actorName} recusou a cobrança de ${formatBRLFromCents(requestRow.amount_cents)} referente a ${requestRow.description_snapshot}.`;
  const body = note ? `${baseBody} Observação: ${note}` : baseBody;

  db.transaction(() => {
    db.prepare(`
      UPDATE shared_debt_requests
      SET status = ?, response_note = ?, updated_at = ?, responded_at = ?
      WHERE id = ? AND receiver_user_id = ? AND status = 'pending'
    `).run(nextStatus, note, now, now, requestId, userId);

    addSharedDebtEvent({ requestId, actorUserId: userId, eventType, note });

    createNotification({
      userId: requestRow.requester_user_id,
      type: 'shared_debt_request',
      title,
      body,
      href: `/shared-debts?request=${requestId}`,
      relatedType: 'shared_debt_request',
      relatedId: requestId
    });
  })();

  setFlash(req, 'success', accepted ? 'Solicitação aceita com sucesso.' : 'Solicitação recusada com sucesso.');
  return res.redirect(`/shared-debts?request=${requestId}`);
});

app.post("/shared-debts/:id/sender-action", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestId = Number(req.params.id);
  const action = String(req.body.action || '').trim().toLowerCase();
  const note = String(req.body.note || '').trim() || null;

  if (!requestId) {
    setFlash(req, 'error', 'Solicitação inválida.');
    return res.redirect('/shared-debts');
  }

  if (!['accept_rejection', 'contest_rejection'].includes(action)) {
    setFlash(req, 'error', 'Ação inválida para esta solicitação.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  const requestRow = db.prepare(`
    SELECT r.*, u.name AS receiver_name, u.email AS receiver_email
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.receiver_user_id
    WHERE r.id = ? AND r.requester_user_id = ?
    LIMIT 1
  `).get(requestId, userId);

  if (!requestRow) {
    setFlash(req, 'error', 'Solicitação não encontrada.');
    return res.redirect('/shared-debts');
  }

  if (requestRow.status !== 'rejected_by_receiver') {
    setFlash(req, 'info', 'Esta solicitação não está aguardando decisão do remetente.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || actor?.email || 'O remetente';
  const now = nowIso();
  const acceptingRejection = action === 'accept_rejection';
  const nextStatus = acceptingRejection ? 'rejection_accepted_by_sender' : 'rejection_contested_by_sender';
  const eventType = nextStatus;
  const title = acceptingRejection ? 'Rejeição aceita pelo remetente' : 'Rejeição contestada pelo remetente';
  const baseBody = acceptingRejection
    ? `${actorName} aceitou a sua recusa da cobrança de ${formatBRLFromCents(requestRow.amount_cents)} referente a ${requestRow.description_snapshot}.`
    : `${actorName} contestou a sua recusa da cobrança de ${formatBRLFromCents(requestRow.amount_cents)} referente a ${requestRow.description_snapshot}.`;
  const body = note ? `${baseBody} Observação: ${note}` : baseBody;

  db.transaction(() => {
    if (acceptingRejection) {
      db.prepare(`
        UPDATE shared_debt_requests
        SET status = ?, updated_at = ?, resolved_at = ?
        WHERE id = ? AND requester_user_id = ? AND status = 'rejected_by_receiver'
      `).run(nextStatus, now, now, requestId, userId);
    } else {
      db.prepare(`
        UPDATE shared_debt_requests
        SET status = ?, updated_at = ?, resolved_at = NULL
        WHERE id = ? AND requester_user_id = ? AND status = 'rejected_by_receiver'
      `).run(nextStatus, now, requestId, userId);
    }

    addSharedDebtEvent({ requestId, actorUserId: userId, eventType, note });

    createNotification({
      userId: requestRow.receiver_user_id,
      type: 'shared_debt_request',
      title,
      body,
      href: `/shared-debts?request=${requestId}`,
      relatedType: 'shared_debt_request',
      relatedId: requestId
    });
  })();

  setFlash(req, 'success', acceptingRejection ? 'Rejeição aceita com sucesso.' : 'Rejeição contestada com sucesso.');
  return res.redirect(`/shared-debts?request=${requestId}`);
});

app.post("/shared-debts/:id/mark-paid", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestId = Number(req.params.id);
  const note = String(req.body.note || '').trim() || null;

  if (!requestId) {
    setFlash(req, 'error', 'Solicitação inválida.');
    return res.redirect('/shared-debts');
  }

  const requestRow = db.prepare(`
    SELECT r.*, u.name AS requester_name, u.email AS requester_email
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.requester_user_id
    WHERE r.id = ? AND r.receiver_user_id = ?
    LIMIT 1
  `).get(requestId, userId);

  if (!requestRow) {
    setFlash(req, 'error', 'Solicitação não encontrada.');
    return res.redirect('/shared-debts');
  }

  if (requestRow.status === 'settled') {
    setFlash(req, 'info', 'Esta dívida já foi liquidada anteriormente.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  if (requestRow.status !== 'accepted') {
    setFlash(req, 'info', 'Somente solicitações aceitas podem ser marcadas como pagas.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  if (requestRow.payment_marked_at) {
    setFlash(req, 'info', 'O pagamento desta solicitação já foi informado e está aguardando confirmação.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || requestRow.receiver_name_snapshot || actor?.email || 'O destinatário';
  const now = nowIso();
  const baseBody = `${actorName} informou que pagou a cobrança de ${formatBRLFromCents(requestRow.amount_cents)} referente a ${requestRow.description_snapshot}.`;
  const body = note ? `${baseBody} Observação: ${note}` : baseBody;

  db.transaction(() => {
    db.prepare(`
      UPDATE shared_debt_requests
      SET payment_marked_at = ?, payment_note = ?, updated_at = ?
      WHERE id = ? AND receiver_user_id = ? AND status = 'accepted' AND payment_marked_at IS NULL
    `).run(now, note, now, requestId, userId);

    addSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'payment_marked_by_receiver', note });

    createNotification({
      userId: requestRow.requester_user_id,
      type: 'shared_debt_request',
      title: 'Pagamento informado na dívida compartilhada',
      body,
      href: `/shared-debts?request=${requestId}`,
      relatedType: 'shared_debt_request',
      relatedId: requestId
    });
  })();

  setFlash(req, 'success', 'Pagamento informado com sucesso. Agora o remetente pode confirmar o recebimento.');
  return res.redirect(`/shared-debts?request=${requestId}`);
});

app.post("/shared-debts/:id/confirm-receipt", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestId = Number(req.params.id);
  const note = String(req.body.note || '').trim() || null;

  if (!requestId) {
    setFlash(req, 'error', 'Solicitação inválida.');
    return res.redirect('/shared-debts');
  }

  const requestRow = db.prepare(`
    SELECT r.*, u.name AS receiver_name, u.email AS receiver_email
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.receiver_user_id
    WHERE r.id = ? AND r.requester_user_id = ?
    LIMIT 1
  `).get(requestId, userId);

  if (!requestRow) {
    setFlash(req, 'error', 'Solicitação não encontrada.');
    return res.redirect('/shared-debts');
  }

  if (requestRow.status === 'settled') {
    setFlash(req, 'info', 'Esta dívida já foi liquidada anteriormente.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  if (requestRow.status !== 'accepted') {
    setFlash(req, 'info', 'Somente solicitações aceitas podem ser liquidadas.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  if (!requestRow.payment_marked_at) {
    setFlash(req, 'info', 'A dívida ainda não foi marcada como paga pelo destinatário.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || actor?.email || 'O remetente';
  const now = nowIso();
  const baseBody = `${actorName} confirmou o recebimento da cobrança de ${formatBRLFromCents(requestRow.amount_cents)} referente a ${requestRow.description_snapshot}.`;
  const body = note ? `${baseBody} Observação: ${note}` : baseBody;

  db.transaction(() => {
    db.prepare(`
      UPDATE shared_debt_requests
      SET status = 'settled', updated_at = ?, resolved_at = ?
      WHERE id = ? AND requester_user_id = ? AND status = 'accepted' AND payment_marked_at IS NOT NULL
    `).run(now, now, requestId, userId);

    addSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'settled', note });

    createNotification({
      userId: requestRow.receiver_user_id,
      type: 'shared_debt_request',
      title: 'Recebimento confirmado na dívida compartilhada',
      body,
      href: `/shared-debts?request=${requestId}`,
      relatedType: 'shared_debt_request',
      relatedId: requestId
    });
  })();

  setFlash(req, 'success', 'Recebimento confirmado com sucesso. A dívida foi liquidada.');
  return res.redirect(`/shared-debts?request=${requestId}`);
});

app.post('/push/subscribe', ensureAuthenticated, (req, res) => {
  if (!isPushConfigured()) {
    return res.status(503).json({ ok: false, error: 'push_unavailable' });
  }

  const subscription = req.body?.subscription;
  const endpoint = String(subscription?.endpoint || '').trim();

  if (!endpoint) {
    return res.status(400).json({ ok: false, error: 'invalid_subscription' });
  }

  try {
    upsertPushSubscription(req.user.id, subscription);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao salvar subscription de push:', err);
    return res.status(500).json({ ok: false, error: 'subscription_save_failed' });
  }
});

app.post('/push/unsubscribe', ensureAuthenticated, (req, res) => {
  const endpoint = String(req.body?.endpoint || '').trim();

  if (!endpoint) {
    return res.status(400).json({ ok: false, error: 'invalid_endpoint' });
  }

  try {
    removePushSubscriptionForUser(req.user.id, endpoint);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao remover subscription de push:', err);
    return res.status(500).json({ ok: false, error: 'subscription_remove_failed' });
  }
});

app.get("/notifications", ensureAuthenticated, (req, res) => {
  return res.redirect('/shared-debts');
});

app.post("/notifications/read-all", ensureAuthenticated, (req, res) => {
  markAllNotificationsAsRead(req.user.id);
  setFlash(req, 'success', 'As notificações foram marcadas como lidas.');
  return res.redirect('/shared-debts');
});

app.post("/notifications/:id/read", ensureAuthenticated, (req, res) => {
  const notificationId = Number(req.params.id);

  if (!notificationId) {
    setFlash(req, 'error', 'Notificação inválida.');
    return res.redirect('/shared-debts');
  }

  const notification = getNotificationForUser(notificationId, req.user.id);
  if (!notification) {
    setFlash(req, 'error', 'Notificação não encontrada.');
    return res.redirect('/shared-debts');
  }

  markNotificationAsRead(notificationId, req.user.id);
  return res.redirect(notification.href || '/shared-debts');
});

app.get("/notifications/:id/open", ensureAuthenticated, (req, res) => {
  const notificationId = Number(req.params.id);

  if (!notificationId) {
    setFlash(req, 'error', 'Notificação inválida.');
    return res.redirect('/shared-debts');
  }

  const notification = getNotificationForUser(notificationId, req.user.id);
  if (!notification) {
    setFlash(req, 'error', 'Notificação não encontrada.');
    return res.redirect('/shared-debts');
  }

  markNotificationAsRead(notificationId, req.user.id);

  const targetHref = String(notification.href || '').trim();
  if (targetHref && targetHref.startsWith('/')) {
    return res.redirect(targetHref);
  }

  return res.redirect('/shared-debts');
});

// People
app.get("/people", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const people = getPeopleAll(userId);
  res.render("people", { people, title: "Pessoas" });
});

app.post("/people", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const name = (req.body.name || "").trim();
  const phone = (req.body.phone || "").trim().replace(/\D/g, "");
  const email = normalizeEmail(req.body.email);
  const id = Number(req.body.id) || null;

  if (id) {
    db.prepare("UPDATE people SET name = ?, phone = ?, email = ? WHERE id = ? AND user_id = ?").run(name, phone, email, id, userId);
  } else if (name) {
    db.prepare("INSERT OR IGNORE INTO people(user_id, name, phone, email, active) VALUES (?, ?, ?, ?, 1)").run(userId, name, phone, email);
  }

  res.redirect("/people");
});

app.post("/people/:id/toggle", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  db.prepare("UPDATE people SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ? AND user_id = ?")
    .run(Number(req.params.id), userId);
  res.redirect("/people");
});

app.post("/people/:id/delete", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const personId = Number(req.params.id);
  const person = db.prepare("SELECT id, name FROM people WHERE id = ? AND user_id = ?").get(personId, userId);

  if (!person) {
    setFlash(req, "error", "Pessoa não encontrada.");
    return res.redirect("/people");
  }

  const usage = db.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM allocations WHERE user_id = ? AND person_id = ?) AS has_allocations,
      EXISTS(SELECT 1 FROM person_payments WHERE user_id = ? AND person_id = ?) AS has_payments
  `).get(userId, personId, userId, personId);

  if (usage.has_allocations || usage.has_payments) {
    setFlash(req, "info", `Não foi possível excluir ${person.name} porque já existe histórico vinculado. Use Desativar para ocultar sem perder os dados passados.`);
    return res.redirect("/people");
  }

  db.prepare("DELETE FROM people WHERE id = ? AND user_id = ?").run(personId, userId);
  setFlash(req, "success", `${person.name} foi removido(a) com sucesso.`);
  return res.redirect("/people");
});

// Cards
app.get("/cards", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  res.render("cards", { cards: getCards(userId) });
});

app.post("/cards", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const name = (req.body.name || "").trim();
  const dueDay = normalizeDayNumber(req.body.due_day);
  const closeDay = normalizeDayNumber(req.body.close_day);

  if (name) {
    db.prepare("INSERT OR IGNORE INTO cards(user_id, name, due_day, close_day, holiday_scope) VALUES (?, ?, ?, ?, ?)")
      .run(userId, name, dueDay, closeDay, "BR");
  }

  res.redirect("/cards");
});

app.post("/cards/:id/update", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  db.prepare("UPDATE cards SET due_day = ?, close_day = ? WHERE id = ? AND user_id = ?")
    .run(normalizeDayNumber(req.body.due_day), normalizeDayNumber(req.body.close_day), Number(req.params.id), userId);
  res.redirect("/cards");
});

app.post("/cards/:id/toggle", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const cardId = Number(req.params.id);
  const card = db.prepare("SELECT id, name, COALESCE(active, 1) AS active FROM cards WHERE id = ? AND user_id = ?").get(cardId, userId);

  if (!card) {
    setFlash(req, "error", "Cartão não encontrado.");
    return res.redirect("/cards");
  }

  db.prepare(`
    UPDATE cards
    SET active = CASE COALESCE(active, 1) WHEN 1 THEN 0 ELSE 1 END
    WHERE id = ? AND user_id = ?
  `).run(cardId, userId);

  const becameActive = card.active !== 1;
  setFlash(
    req,
    "success",
    becameActive
      ? `${card.name} foi reativado e voltou a aparecer nos novos lançamentos.`
      : `${card.name} foi desativado e ficará oculto em novos lançamentos/importações, sem afetar o histórico.`
  );
  return res.redirect("/cards");
});

app.post("/cards/:id/delete", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const cardId = Number(req.params.id);
  const card = db.prepare("SELECT id, name FROM cards WHERE id = ? AND user_id = ?").get(cardId, userId);

  if (!card) {
    setFlash(req, "error", "Cartão não encontrado.");
    return res.redirect("/cards");
  }

  const usage = db.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM transactions WHERE user_id = ? AND card_id = ?) AS has_transactions,
      EXISTS(SELECT 1 FROM card_statements WHERE user_id = ? AND card_id = ?) AS has_statements
  `).get(userId, cardId, userId, cardId);

  if (usage.has_transactions || usage.has_statements) {
    setFlash(req, "info", `Não foi possível excluir ${card.name} porque já existe histórico vinculado. Use Desativar para ocultar o cartão sem perder dados passados.`);
    return res.redirect("/cards");
  }

  db.transaction(() => {
    db.prepare("DELETE FROM imports WHERE user_id = ? AND card_id = ?").run(userId, cardId);
    db.prepare("DELETE FROM cards WHERE id = ? AND user_id = ?").run(cardId, userId);
  })();

  setFlash(req, "success", `${card.name} foi excluído com sucesso.`);
  return res.redirect("/cards");
});

// Import
app.get("/import", ensureAuthenticated, ensureCanImport, (req, res) => {
  const userId = req.user.id;
  res.render("import", { cards: getActiveCards(userId), error: null });
});

app.post("/import", ensureAuthenticated, ensureCanImport, upload.single("csvfile"), (req, res) => {
  const userId = req.user.id;
  const cards = getActiveCards(userId);

  try {
    const cardId = Number(req.body.card_id);
    const month = Number(req.body.month);
    const year = Number(req.body.year);

    if (!req.file) throw new Error("Envie um arquivo CSV.");
    if (!cardId) throw new Error("Selecione o cartão.");
    if (!month || month < 1 || month > 12) throw new Error("Mês inválido.");
    if (!year || year < 2000 || year > 2100) throw new Error("Ano inválido.");

    const card = db.prepare("SELECT id, name FROM cards WHERE id = ? AND user_id = ? AND COALESCE(active, 1) = 1").get(cardId, userId);
    if (!card) throw new Error("Cartão inválido ou desativado.");

    const txns = parseCsvByCardName(card.name, req.file.buffer);

    const info = db.prepare(`
      INSERT INTO imports(user_id, card_id, month, year, created_at, original_filename)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, cardId, month, year, nowIso(), req.file.originalname);

    const insTxn = db.prepare(`
      INSERT INTO transactions(user_id, import_id, card_id, txn_date, description, amount_cents, card_number, raw_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items) => {
      for (const t of items) {
        const isoDate = toISOFromBRDate(t.txn_date) || null;
        insTxn.run(userId, info.lastInsertRowid, cardId, isoDate, t.description, t.amount_cents, t.card_number || null, JSON.stringify(t.raw || {}), nowIso());
      }
    });

    insertMany(txns);
    res.redirect(`/month/${year}/${month}`);
  } catch (e) {
    res.status(400).render("import", { cards, error: e.message || String(e) });
  }
});

function buildOrder(sort, dir) {
  const d = (dir || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const sortMap = {
    date: "t.txn_date",
    amount: "t.amount_cents",
    card: "c.name",
    desc: "t.description",
    allocated: "alloc_count",
    number: "t.card_number"
  };
  const col = sortMap[sort] || "t.txn_date";
  if (sort === "date") return `t.txn_date IS NULL ASC, ${col} ${d}, t.id ${d}`;
  return `${col} ${d}, t.id ${d}`;
}

// Rota para definir o Titular
app.post("/people/:id/set-owner", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);

  db.transaction(() => {
    db.prepare("UPDATE people SET is_owner = 0 WHERE user_id = ?").run(userId);
    db.prepare("UPDATE people SET is_owner = 1 WHERE id = ? AND user_id = ?").run(id, userId);
  })();

  res.redirect("/people");
});

// Rota Principal do detalhamento
app.get("/detalhamento/:year/:month", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const { year, month } = req.params;
  const currentMonth = parseInt(month);
  const currentYear = parseInt(year);

  syncRecurringTransactions(userId, currentYear, currentMonth);

  const existingExpenses = db.prepare(`
    SELECT COUNT(*) as count
    FROM monthly_finances
    WHERE user_id = ? AND month = ? AND year = ? AND type = 'expense'
  `).get(userId, currentMonth, currentYear);

  if (existingExpenses.count === 0) {
    let prevM = currentMonth - 1;
    let prevY = currentYear;
    if (prevM < 1) { prevM = 12; prevY--; }

    const prevExpenses = db.prepare(`
      SELECT *
      FROM monthly_finances
      WHERE user_id = ? AND month = ? AND year = ? AND type = 'expense'
    `).all(userId, prevM, prevY);

    if (prevExpenses.length > 0) {
      const insertClone = db.prepare(`
        INSERT INTO monthly_finances (user_id, month, year, type, description, category_id, formula, amount_cents, created_at)
        VALUES (?, ?, ?, 'expense', ?, ?, '', 0, ?)
      `);

      db.transaction(() => {
        for (const exp of prevExpenses) {
          insertClone.run(userId, currentMonth, currentYear, exp.description, exp.category_id, new Date().toISOString());
        }
      })();
    }
  }

  const owner = db.prepare("SELECT * FROM people WHERE user_id = ? AND is_owner = 1 LIMIT 1").get(userId);
  if (!owner) return res.status(400).send("Defina um titular na aba Pessoas primeiro.");

  const cardTotal = db.prepare(`
    SELECT COALESCE(SUM(a.share_cents), 0) as total
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
      AND (
        (i.month = ? AND i.year = ?) OR
        (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
      )
  `).get(userId, owner.id, currentMonth, currentYear, currentMonth, currentYear);

  const finances = db.prepare(`
    SELECT *
    FROM monthly_finances
    WHERE user_id = ? AND month = ? AND year = ?
  `).all(userId, currentMonth, currentYear);

  const categories = db.prepare("SELECT * FROM finance_categories WHERE user_id = ? AND is_active = 1").all(userId);

  let notes = db.prepare("SELECT * FROM scratchpad WHERE user_id = ? AND month = ? AND year = ?").get(userId, currentMonth, currentYear);
  if (!notes) {
    db.prepare("INSERT INTO scratchpad (user_id, month, year, content_text, content_math) VALUES (?, ?, ?, '', '')")
      .run(userId, currentMonth, currentYear);
    notes = { content_text: '', content_math: '' };
  }

  const isClosed = isMonthClosed(userId, currentMonth, currentYear);
  const visibleCards = getVisibleCardsForMonth(userId, currentMonth, currentYear);
  const cards = getActiveCards(userId).map(({ id, name, close_day, due_day }) => ({ id, name, close_day, due_day }));

  const cardTotalsRows = db.prepare(`
    SELECT t.card_id, SUM(t.amount_cents) AS total_cents
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (i.month = ? AND i.year = ?) OR
        (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
      )
    GROUP BY t.card_id
  `).all(userId, currentMonth, currentYear, currentMonth, currentYear);
  const cardTotalsMap = new Map(cardTotalsRows.map(row => [row.card_id, row.total_cents || 0]));

  const statementRows = db.prepare(`
    SELECT card_id, computed_due_date, override_due_date, paid_cents
    FROM card_statements
    WHERE user_id = ? AND month = ? AND year = ?
  `).all(userId, currentMonth, currentYear);
  const statementByCard = new Map(statementRows.map(row => [row.card_id, row]));

  const sharedDebtSummary = getAcceptedSharedDebtSummaryForMonth(userId, currentMonth, currentYear);

  const alerts = [];
  const unreadSharedDebtNotifications = db.prepare(`
    SELECT title, body, href, created_at
    FROM notifications
    WHERE user_id = ? AND is_read = 0 AND (related_type = 'shared_debt_request' OR type = 'shared_debt_request')
    ORDER BY created_at DESC
    LIMIT 5
  `).all(userId);

  if (unreadSharedDebtNotifications.length) {
    const newest = unreadSharedDebtNotifications[0];
    alerts.push({
      type: 'info',
      icon: '🤝',
      title: unreadSharedDebtNotifications.length === 1 ? newest.title : 'Dívidas compartilhadas pendentes',
      description: unreadSharedDebtNotifications.length === 1
        ? (newest.body || 'Você recebeu uma nova solicitação de dívida compartilhada.')
        : `Você tem ${unreadSharedDebtNotifications.length} atualização(ões) sobre dívidas compartilhadas aguardando sua análise.`,
      href: newest.href || '/shared-debts'
    });
  } else {
    const pendingSharedDebtCount = db.prepare(`
      SELECT COUNT(*) AS total
      FROM shared_debt_requests
      WHERE receiver_user_id = ? AND status = 'pending'
    `).get(userId)?.total || 0;

    if (pendingSharedDebtCount > 0) {
      alerts.push({
        type: 'warning',
        icon: '📨',
        title: 'Cobranças aguardando sua análise',
        description: `${pendingSharedDebtCount} solicitação(ões) de dívida compartilhada estão pendentes para você.`,
        href: '/shared-debts#received'
      });
    }
  }

  const today = dayjs();
  const isCurrentReferenceMonth = currentYear === today.year() && currentMonth === (today.month() + 1);

  if (isCurrentReferenceMonth) {
    const closingTodayCards = getActiveCards(userId).filter(card => {
      const closeDay = normalizeDayNumber(card.close_day);
      return closeDay && Math.min(closeDay, today.daysInMonth()) === today.date();
    });

    if (closingTodayCards.length) {
      alerts.push({
        type: 'info',
        icon: '⏰',
        title: 'Cartão fecha hoje',
        description: `${closingTodayCards.map(card => card.name).join(', ')} ${closingTodayCards.length === 1 ? 'fecha' : 'fecham'} hoje.`
      });
    }

    const dueSoonCards = visibleCards
      .map(card => {
        const stmt = statementByCard.get(card.id);
        const computedDueDate = computeDueDate({ year: currentYear, month: currentMonth, dueDay: card.due_day, holidayScope: card.holiday_scope || 'BR' });
        const dueDate = stmt?.override_due_date || stmt?.computed_due_date || computedDueDate;
        const totalCents = cardTotalsMap.get(card.id) || 0;
        const diffDays = dueDate ? dayjs(dueDate).startOf('day').diff(today.startOf('day'), 'day') : null;
        return { card_name: card.name, due_date: dueDate, total_cents: totalCents, diff_days: diffDays };
      })
      .filter(item => item.total_cents > 0 && item.due_date && item.diff_days >= 0 && item.diff_days <= 2);

    if (dueSoonCards.length) {
      alerts.push({
        type: 'warning',
        icon: '📅',
        title: 'Vencimento em até 2 dias',
        description: dueSoonCards.map(item => `${item.card_name} (${dayjs(item.due_date).format('DD/MM')})`).join(', ')
      });
    }
  }

  const senderDecisionCount = db.prepare(`
    SELECT COUNT(*) AS total
    FROM shared_debt_requests
    WHERE requester_user_id = ? AND status = 'rejected_by_receiver'
  `).get(userId)?.total || 0;

  if (senderDecisionCount > 0) {
    alerts.push({
      type: 'warning',
      icon: '⚖️',
      title: 'Rejeições aguardando sua decisão',
      description: `${senderDecisionCount} solicitação(ões) recusadas aguardam você aceitar a rejeição ou contestá-la.`,
      href: '/shared-debts#sent'
    });
  }

  const pendingReceiptConfirmationCount = db.prepare(`
    SELECT COUNT(*) AS total
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND status = 'accepted'
      AND payment_marked_at IS NOT NULL
  `).get(userId)?.total || 0;

  if (pendingReceiptConfirmationCount > 0) {
    alerts.push({
      type: 'warning',
      icon: '✅',
      title: 'Pagamentos aguardando sua confirmação',
      description: `${pendingReceiptConfirmationCount} dívida(s) compartilhada(s) já foram marcadas como pagas e aguardam sua confirmação de recebimento.`,
      href: '/shared-debts#sent'
    });
  }

  if (!isClosed) {
    const unassignedCount = db.prepare(`
      SELECT COUNT(*) AS total
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      WHERE t.user_id = ?
        AND (
          (i.month = ? AND i.year = ?) OR
          (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
        )
        AND NOT EXISTS (
          SELECT 1 FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id
        )
    `).get(userId, currentMonth, currentYear, currentMonth, currentYear)?.total || 0;

    if (unassignedCount > 0) {
      alerts.push({
        type: 'warning',
        icon: '👥',
        title: 'Itens sem distribuição',
        description: `${unassignedCount} lançamento(s) deste mês ainda não foram distribuídos entre as pessoas.`,
        href: `/month/${currentYear}/${currentMonth}?f_allocated=nao`
      });
    }

    const missingPaymentCards = visibleCards
      .map(card => {
        const stmt = statementByCard.get(card.id);
        const computedDueDate = computeDueDate({ year: currentYear, month: currentMonth, dueDay: card.due_day, holidayScope: card.holiday_scope || 'BR' });
        const dueDate = stmt?.override_due_date || stmt?.computed_due_date || computedDueDate;
        const duePassed = dueDate ? dayjs(dueDate).startOf('day').isBefore(today.startOf('day')) : false;
        return {
          card_name: card.name,
          total_cents: cardTotalsMap.get(card.id) || 0,
          paid_cents: Number(stmt?.paid_cents || 0),
          due_date: dueDate,
          due_passed: duePassed
        };
      })
      .filter(item => item.total_cents > 0 && item.due_passed && item.paid_cents <= 0);

    if (missingPaymentCards.length) {
      alerts.push({
        type: 'info',
        icon: '💳',
        title: 'Valor pago ainda não informado',
        description: `${missingPaymentCards.map(item => `${item.card_name} (${dayjs(item.due_date).format('DD/MM')})`).join(', ')} ainda ${missingPaymentCards.length === 1 ? 'não tem' : 'não têm'} valor pago informado no resumo.`,
        href: `/summary/${currentYear}/${currentMonth}`
      });
    }
  }

  res.render("detalhamento", {
    title: "Meu Detalhamento",
    year: currentYear,
    month: currentMonth,
    owner,
    cardTotalCents: cardTotal ? cardTotal.total : 0,
    finances,
    categories,
    notes,
    formatBRLFromCents,
    isClosed,
    alerts,
    cards,
    sharedDebtSummary
  });
});

app.get("/month/:year/:month", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;

  syncRecurringTransactions(userId, year, month);

  const sort = (req.query.sort || "date").toString();
  const dir = (req.query.dir || "asc").toString();
  const orderBy = buildOrder(sort, dir);

  const filters = {
    f_date: (req.query.f_date || "").toString().trim(),
    f_desc: (req.query.f_desc || "").toString().trim(),
    f_card: (req.query.f_card || "").toString().trim(),
    f_number: (req.query.f_number || "").toString().trim(),
    f_amount: (req.query.f_amount || "").toString().trim(),
    f_allocated: (req.query.f_allocated || "").toString().trim(),
    f_person: (req.query.f_person || "").toString().trim()
  };

  const allocCountExpr = "(SELECT COUNT(*) FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id)";
  const selectedCsvExpr = "(SELECT GROUP_CONCAT(a.person_id) FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id)";

  const where = ["((i.month = ? AND i.year = ?) OR (t.due_month = ? AND t.due_year = ?))"];
  const params = [month, year, month, year];

  if (filters.f_desc) {
    where.push("t.description LIKE ?");
    params.push(`%${filters.f_desc}%`);
  }

  if (filters.f_card) {
    where.push("c.name LIKE ?");
    params.push(`%${filters.f_card}%`);
  }

  if (filters.f_number) {
    where.push("COALESCE(t.card_number, '') LIKE ?");
    params.push(`%${filters.f_number}%`);
  }

  if (filters.f_date) {
    where.push("COALESCE(t.txn_date, '') LIKE ?");
    params.push(`%${filters.f_date}%`);
  }

  if (filters.f_amount) {
    const digits = filters.f_amount.replace(/\D/g, "");
    if (digits) {
      where.push("CAST(ABS(t.amount_cents) AS TEXT) LIKE ?");
      params.push(likeParam(digits));
    }
  }

  if (filters.f_allocated) {
    const f = filters.f_allocated.toLowerCase();
    if (f.startsWith("s")) where.push(`${allocCountExpr} > 0`);
    else if (f.startsWith("n")) where.push(`${allocCountExpr} = 0`);
  }

  if (filters.f_person) {
    const personId = Number(filters.f_person);
    if (personId > 0) {
      where.push(`EXISTS (SELECT 1 FROM allocations a_filter WHERE a_filter.transaction_id = t.id AND a_filter.user_id = t.user_id AND a_filter.person_id = ?)`);
      params.push(personId);
    } else {
      filters.f_person = "";
    }
  }

  const txns = db.prepare(`
    SELECT t.id, t.txn_date, t.description, t.amount_cents, t.card_number, c.name AS card_name,
           t.parent_txn_id, t.due_month, t.due_year,
           ${allocCountExpr} AS alloc_count,
           ${selectedCsvExpr} AS selected_csv
    FROM transactions t
    LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ? AND ${where.join(" AND ")}
    ORDER BY ${orderBy}
  `).all(userId, ...params);

  txns.forEach(t => {
    t.selected_ids = (t.selected_csv ? t.selected_csv.split(",").map(x => Number(x)) : []).filter(Boolean);
    t.has_future_installments = hasFutureInstallments(userId, t);
  });

  const people = getVisiblePeopleForMonth(userId, month, year);
  const cards = getActiveCards(userId);
  const recurringRules = getRecurringRules(userId).map(rule => {
    const preview = getRecurringPreview(rule);
    const startDate = dayjs(rule.start_txn_date);
    return {
      ...rule,
      purchase_day: startDate.isValid() ? startDate.date() : null,
      start_due_label: monthLabel(rule.start_due_month, rule.start_due_year),
      active_from_label: monthLabel(rule.active_from_month, rule.active_from_year),
      preview_label: preview ? monthLabel(preview.month, preview.year) : null
    };
  });
  const isClosed = isMonthClosed(userId, month, year);
  const baseParams = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) baseParams.set(k, v); });

  const sortLink = (key) => {
    const p = new URLSearchParams(baseParams);
    const nextDir = (sort === key && dir === "asc") ? "desc" : "asc";
    p.set("sort", key);
    p.set("dir", nextDir);
    const qs = p.toString();
    return `/month/${year}/${month}${qs ? `?${qs}` : ""}`;
  };

  res.render("month", { month, year, txns, people, cards, recurringRules, formatBRLFromCents, sort, dir, sortLink, filters, isClosed });
});

app.post("/txn/manual", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const { date, description, amount, card_id, first_due, installments } = req.body;
  const isRecurring = ["1", "true", "on", "sim"].includes(String(req.body.is_recurring || "").toLowerCase());

  try {
    const cardIdNum = Number(card_id);
    if (!cardIdNum || isNaN(cardIdNum)) {
      return res.status(400).send("Cartao invalido. Selecione um cartao valido.");
    }

    const cardExists = db.prepare("SELECT id, close_day, due_day FROM cards WHERE id = ? AND user_id = ? AND COALESCE(active, 1) = 1").get(cardIdNum, userId);
    if (!cardExists) {
      return res.status(400).send("Cartao nao encontrado no sistema ou esta desativado.");
    }

    const totalCents = centsFromPtBrMoney(amount);
    const numInstallments = parseInt(installments) || 1;
    if (isRecurring && numInstallments !== 1) {
      setFlash(req, "error", "Lançamentos recorrentes mensais funcionam apenas com 1 parcela.");
      return res.redirect(redirectBackOr(req, "/geral"));
    }

    const installmentValue = Math.floor(totalCents / numInstallments);
    const remainder = totalCents % numInstallments;

    const resolvedFirstDue = resolveFirstDueMonth({
      firstDue: first_due,
      purchaseDate: date,
      closeDay: cardExists.close_day,
      dueDay: cardExists.due_day
    });

    if (!resolvedFirstDue) {
      throw new Error("Nao foi possivel determinar o primeiro vencimento. Verifique a data da compra informada.");
    }

    let [startYear, startMonth] = resolvedFirstDue.split('-').map(Number);
    const installmentMonths = getInstallmentMonths(startYear, startMonth, numInstallments);
    const lockedInstallment = installmentMonths.find(item => isMonthClosed(userId, item.month, item.year));

    if (lockedInstallment) {
      setFlash(req, "error", `Não é possível criar este lançamento porque ${monthLabel(lockedInstallment.month, lockedInstallment.year)} está fechado.`);
      return res.redirect(redirectBackOr(req, `/month/${lockedInstallment.year}/${lockedInstallment.month}`));
    }

    let recurringRuleId = null;
    const createdTxnIds = [];

    db.transaction(() => {
      const activePeople = db.prepare("SELECT id FROM people WHERE user_id = ? AND active = 1").all(userId);
      const insTxn = db.prepare(`
        INSERT INTO transactions (user_id, card_id, txn_date, description, amount_cents, due_month, due_year, parent_txn_id, recurring_rule_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insAlloc = db.prepare(`
        INSERT INTO allocations (user_id, transaction_id, person_id, share_cents, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insRecurring = db.prepare(`
        INSERT INTO recurring_rules (user_id, card_id, description, amount_cents, start_txn_date, start_due_month, start_due_year, active_from_month, active_from_year, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `);

      if (isRecurring) {
        const info = insRecurring.run(userId, cardIdNum, description, totalCents, date, startMonth, startYear, startMonth, startYear, nowIso(), nowIso());
        recurringRuleId = Number(info.lastInsertRowid);
      }

      let installmentRootTxnId = null;

      for (let i = 0; i < numInstallments; i++) {
        let currentMonth = startMonth + i;
        let currentYear = startYear;
        while (currentMonth > 12) { currentMonth -= 12; currentYear += 1; }

        const finalDesc = numInstallments > 1
          ? `${description} (${String(i + 1).padStart(2, '0')}/${String(numInstallments).padStart(2, '0')})`
          : description;

        const currentAmount = (i === numInstallments - 1) ? installmentValue + remainder : installmentValue;
        const currentRecurringRuleId = isRecurring ? recurringRuleId : null;
        const currentParentTxnId = (numInstallments > 1 && installmentRootTxnId) ? installmentRootTxnId : null;

        const info = insTxn.run(userId, cardIdNum, date, finalDesc, currentAmount, currentMonth, currentYear, currentParentTxnId, currentRecurringRuleId, nowIso());
        const txnIdCreated = Number(info.lastInsertRowid);
        if (!installmentRootTxnId) installmentRootTxnId = txnIdCreated;

        if (activePeople.length === 1) {
          insAlloc.run(userId, txnIdCreated, activePeople[0].id, currentAmount, nowIso());
          createdTxnIds.push(txnIdCreated);
        }
      }
    })();

    createdTxnIds.forEach(txnIdCreated => syncSharedDebtRequestsForTransaction(userId, txnIdCreated));

    if (isRecurring) {
      setFlash(req, "success", "Lançamento recorrente mensal criado com sucesso.");
    }

    res.redirect(`/month/${startYear}/${startMonth}`);
  } catch (err) {
    res.status(500).send("Erro ao processar transacao manual: " + err.message);
  }
});

app.post("/recurring/:id/state", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const ruleId = Number(req.params.id);
  const action = String(req.body.action || '').trim().toLowerCase();
  const rule = db.prepare("SELECT * FROM recurring_rules WHERE id = ? AND user_id = ?").get(ruleId, userId);

  if (!rule) {
    setFlash(req, "error", "Lançamento recorrente não encontrado.");
    return res.redirect(redirectBackOr(req, "/month"));
  }

  const today = dayjs();
  const currentYear = today.year();
  const currentMonth = today.month() + 1;

  if (action === 'pause') {
    db.prepare("UPDATE recurring_rules SET status = 'paused', updated_at = ? WHERE id = ? AND user_id = ?").run(nowIso(), ruleId, userId);
    removeFutureRecurringTransactions(userId, ruleId, currentYear, currentMonth);
    setFlash(req, "success", `${rule.description} foi pausado.`);
  } else if (action === 'resume') {
    db.prepare(`
      UPDATE recurring_rules
      SET status = 'active', active_from_month = ?, active_from_year = ?, ended_at = NULL, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(currentMonth, currentYear, nowIso(), ruleId, userId);
    syncRecurringTransactions(userId, currentYear, currentMonth);
    setFlash(req, "success", `${rule.description} foi reativado.`);
  } else if (action === 'end') {
    db.prepare("UPDATE recurring_rules SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(nowIso(), nowIso(), ruleId, userId);
    removeFutureRecurringTransactions(userId, ruleId, currentYear, currentMonth);
    setFlash(req, "success", `${rule.description} foi encerrado.`);
  } else {
    setFlash(req, "error", "Ação inválida para lançamento recorrente.");
  }

  return res.redirect(redirectBackOr(req, "/month"));
});

app.post("/txn/:id/alloc", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);

  const txn = getTransactionScopeRow(userId, id);

  if (!txn) return res.status(404).send("Transação não encontrada.");
  if (isMonthClosed(userId, txn.month, txn.year)) {
    return res.status(423).send(getMonthLockMessage(txn.month, txn.year));
  }

  const applyScope = String(req.body.apply_scope || 'single').trim().toLowerCase();
  const targetRows = getInstallmentScopeRows(userId, txn, applyScope);
  const lockedTarget = targetRows.find(row => isMonthClosed(userId, row.month, row.year));
  if (lockedTarget) {
    return res.status(423).send(getMonthLockMessage(lockedTarget.month, lockedTarget.year));
  }

  let personIds = req.body.person_ids || [];
  if (!Array.isArray(personIds)) personIds = [personIds];
  const validPeople = new Set(getPeopleAll(userId).map(p => p.id));
  personIds = personIds.map(Number).filter(pid => validPeople.has(pid));

  const del = db.prepare("DELETE FROM allocations WHERE transaction_id = ? AND user_id = ?");
  const ins = db.prepare("INSERT INTO allocations(user_id, transaction_id, person_id, share_cents, created_at) VALUES (?, ?, ?, ?, ?)");

  db.transaction(() => {
    targetRows.forEach(targetTxn => {
      clearSharedDebtAllocationLinksForTransaction(userId, targetTxn.id);
      del.run(targetTxn.id, userId);
      if (personIds.length > 0) {
        const share = Math.floor(targetTxn.amount_cents / personIds.length);
        const remainder = targetTxn.amount_cents - (share * personIds.length);
        personIds.forEach((pid, idx) => {
          const s = share + (idx < Math.abs(remainder) ? Math.sign(remainder) : 0);
          ins.run(userId, targetTxn.id, pid, s, nowIso());
        });
      }
    });
  })();

  targetRows.forEach(targetTxn => syncSharedDebtRequestsForTransaction(userId, targetTxn.id));

  res.redirect(`/month/${txn.year}/${txn.month}`);
});

// Detail page
app.get("/txn/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);
  const txn = db.prepare(`
    SELECT t.id, t.txn_date, t.description, t.amount_cents, t.card_number, t.parent_txn_id, c.name AS card_name,
           COALESCE(t.due_month, i.month) as month,
           COALESCE(t.due_year, i.year) as year
    FROM transactions t
    LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.id = ? AND t.user_id = ?
  `).get(id, userId);

  if (!txn) return res.status(404).send("Transação não encontrada.");

  const people = getVisiblePeopleForTransaction(userId, id);
  const selected = db.prepare("SELECT person_id FROM allocations WHERE transaction_id = ? AND user_id = ?")
    .all(id, userId)
    .map(r => r.person_id);
  const isClosed = isMonthClosed(userId, txn.month, txn.year);
  const hasFutureInstallmentsForTxn = hasFutureInstallments(userId, txn);

  res.render("txn", { txn, people, selected, formatBRLFromCents, isClosed, hasFutureInstallments: hasFutureInstallmentsForTxn });
});

app.post("/txn/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);

  const txn = getTransactionScopeRow(userId, id);

  if (!txn) return res.status(404).send("Transação não encontrada.");
  if (isMonthClosed(userId, txn.month, txn.year)) {
    setFlash(req, "error", getMonthLockMessage(txn.month, txn.year));
    return res.redirect(`/month/${txn.year}/${txn.month}`);
  }

  const applyScope = String(req.body.apply_scope || 'single').trim().toLowerCase();
  const targetRows = getInstallmentScopeRows(userId, txn, applyScope);
  const lockedTarget = targetRows.find(row => isMonthClosed(userId, row.month, row.year));
  if (lockedTarget) {
    setFlash(req, "error", getMonthLockMessage(lockedTarget.month, lockedTarget.year));
    return res.redirect(`/month/${txn.year}/${txn.month}`);
  }

  let personIds = req.body.person_ids || [];
  if (!Array.isArray(personIds)) personIds = [personIds];
  const validPeople = new Set(getPeopleAll(userId).map(p => p.id));
  personIds = personIds.map(Number).filter(pid => validPeople.has(pid));

  const del = db.prepare("DELETE FROM allocations WHERE transaction_id = ? AND user_id = ?");
  const ins = db.prepare("INSERT INTO allocations(user_id, transaction_id, person_id, share_cents, created_at) VALUES (?, ?, ?, ?, ?)");

  db.transaction(() => {
    targetRows.forEach(targetTxn => {
      clearSharedDebtAllocationLinksForTransaction(userId, targetTxn.id);
      del.run(targetTxn.id, userId);
      if (personIds.length > 0) {
        const share = Math.floor(targetTxn.amount_cents / personIds.length);
        const remainder = targetTxn.amount_cents - (share * personIds.length);
        personIds.forEach((pid, idx) => {
          const s = share + (idx < Math.abs(remainder) ? Math.sign(remainder) : 0);
          ins.run(userId, targetTxn.id, pid, s, nowIso());
        });
      }
    });
  })();

  targetRows.forEach(targetTxn => syncSharedDebtRequestsForTransaction(userId, targetTxn.id));

  res.redirect(`/month/${txn.year}/${txn.month}`);
});

app.post("/txn/:id/delete", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);

  const txn = getTransactionScopeRow(userId, id);

  if (!txn) {
    setFlash(req, "error", "Lançamento não encontrado.");
    return res.redirect("/geral");
  }
  if (isMonthClosed(userId, txn.month, txn.year)) {
    setFlash(req, "error", getMonthLockMessage(txn.month, txn.year));
    return res.redirect(`/month/${txn.year}/${txn.month}`);
  }

  const applyScope = String(req.body.apply_scope || 'single').trim().toLowerCase();
  const targetRows = getInstallmentScopeRows(userId, txn, applyScope);
  const lockedTarget = targetRows.find(row => isMonthClosed(userId, row.month, row.year));
  if (lockedTarget) {
    setFlash(req, "error", getMonthLockMessage(lockedTarget.month, lockedTarget.year));
    return res.redirect(`/month/${txn.year}/${txn.month}`);
  }

  db.transaction(() => {
    targetRows.forEach(targetTxn => {
      if (targetTxn.recurring_rule_id && targetTxn.month && targetTxn.year) {
        db.prepare(`
          INSERT OR IGNORE INTO recurring_exceptions (user_id, rule_id, month, year, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(userId, targetTxn.recurring_rule_id, targetTxn.month, targetTxn.year, nowIso());
      }
    });
    deleteTransactionsAndAllocations(userId, targetRows);
  })();

  const deletedCount = targetRows.length;
  setFlash(req, "success", deletedCount > 1 ? `${deletedCount} lançamento(s) excluídos com sucesso.` : "Lançamento excluído com sucesso.");
  return res.redirect(`/month/${txn.year}/${txn.month}`);
});

// Summary (minimal)
function upsertCardStatementsForMonth(userId, month, year, entries) {
  const cardsById = new Map(getCards(userId).map(card => [card.id, card]));
  const findStatement = db.prepare("SELECT 1 FROM card_statements WHERE user_id = ? AND card_id = ? AND month = ? AND year = ?");
  const insertStatement = db.prepare(`
    INSERT INTO card_statements (user_id, card_id, month, year, computed_due_date, override_due_date, paid_cents, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStatement = db.prepare(`
    UPDATE card_statements
    SET computed_due_date = ?, override_due_date = ?, paid_cents = ?, updated_at = ?
    WHERE user_id = ? AND card_id = ? AND month = ? AND year = ?
  `);

  db.transaction((rows) => {
    rows.forEach((entry) => {
      const card_id = Number(entry.card_id);
      if (!card_id || !cardsById.has(card_id)) return;

      const paid_cents = centsFromPtBrMoney(entry.paid);
      const override_due_date = (entry.override_due || "").toString().trim() || null;
      const card = cardsById.get(card_id);
      const computed_due_date = computeDueDate({ year, month, dueDay: card?.due_day, holidayScope: card?.holiday_scope || "BR" });
      const now = nowIso();
      const existing = findStatement.get(userId, card_id, month, year);

      if (existing) {
        updateStatement.run(computed_due_date, override_due_date, paid_cents, now, userId, card_id, month, year);
      } else {
        insertStatement.run(userId, card_id, month, year, computed_due_date, override_due_date, paid_cents, now, now);
      }
    });
  })(entries);
}

function upsertPersonPaymentsForMonth(userId, month, year, entries) {
  const validPeople = new Set(getPeopleAll(userId).map(person => person.id));
  const findPayment = db.prepare("SELECT 1 FROM person_payments WHERE user_id = ? AND person_id = ? AND month = ? AND year = ?");
  const insertPayment = db.prepare(`
    INSERT INTO person_payments (user_id, person_id, month, year, paid_cents, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updatePayment = db.prepare(`
    UPDATE person_payments
    SET paid_cents = ?, updated_at = ?
    WHERE user_id = ? AND person_id = ? AND month = ? AND year = ?
  `);

  db.transaction((rows) => {
    rows.forEach((entry) => {
      const person_id = Number(entry.person_id);
      if (!person_id || !validPeople.has(person_id)) return;

      const paid_cents = centsFromPtBrMoney(entry.paid);
      const now = nowIso();
      const existing = findPayment.get(userId, person_id, month, year);

      if (existing) {
        updatePayment.run(paid_cents, now, userId, person_id, month, year);
      } else {
        insertPayment.run(userId, person_id, month, year, paid_cents, now, now);
      }
    });
  })(entries);
}

app.get("/summary/:year/:month", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;
  syncRecurringTransactions(userId, year, month);
  const isClosed = isMonthClosed(userId, month, year);

  const people = getVisiblePeopleForMonth(userId, month, year, { includePayments: true });
  const cards = getVisibleCardsForMonth(userId, month, year);

  const allocRows = db.prepare(`
    SELECT a.person_id, t.card_id, SUM(a.share_cents) AS total_cents
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND (
        (i.month = ? AND i.year = ?) OR
        (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
      )
    GROUP BY a.person_id, t.card_id
  `).all(userId, month, year, month, year);

  const allocByPersonCard = new Map();
  const personTotalsMap = new Map();

  allocRows.forEach(row => {
    const total = row.total_cents || 0;
    allocByPersonCard.set(`${row.person_id}-${row.card_id}`, total);
    personTotalsMap.set(row.person_id, (personTotalsMap.get(row.person_id) || 0) + total);
  });

  const rows = [];
  people.forEach(person => {
    cards.forEach(card => {
      rows.push({
        person_id: person.id,
        person_name: person.name,
        card_id: card.id,
        card_name: card.name,
        total_cents: allocByPersonCard.get(`${person.id}-${card.id}`) || 0
      });
    });
  });

  const unassigned = db.prepare(`
    SELECT c.name AS card_name, COALESCE(SUM(t.amount_cents), 0) AS total_cents
    FROM transactions t
    JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (i.month = ? AND i.year = ?) OR
        (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
      )
      AND NOT EXISTS (
        SELECT 1 FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id
      )
    GROUP BY c.id
    ORDER BY c.name
  `).all(userId, month, year, month, year);

  const cardTotalsRows = db.prepare(`
    SELECT t.card_id, SUM(t.amount_cents) AS total_cents
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (i.month = ? AND i.year = ?) OR
        (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
      )
    GROUP BY t.card_id
  `).all(userId, month, year, month, year);
  const cardTotalsMap = new Map(cardTotalsRows.map(row => [row.card_id, row.total_cents || 0]));

  const stmtRows = db.prepare(`
    SELECT card_id, computed_due_date, override_due_date, paid_cents
    FROM card_statements
    WHERE user_id = ? AND month = ? AND year = ?
  `).all(userId, month, year);
  const stmtByCard = new Map(stmtRows.map(row => [row.card_id, row]));

  const cardsPanel = cards
    .map(card => {
      const stmt = stmtByCard.get(card.id);
      const computed = computeDueDate({ year, month, dueDay: card.due_day, holidayScope: card.holiday_scope || "BR" });
      const due_date = stmt?.override_due_date || stmt?.computed_due_date || computed;
      return {
        card_id: card.id,
        card_name: card.name,
        computed_due_date: computed,
        due_date,
        paid_cents: stmt ? stmt.paid_cents : 0,
        total_cents: cardTotalsMap.get(card.id) || 0
      };
    })
    .sort((a, b) => {
      const aTime = a.due_date ? dayjs(a.due_date).valueOf() : Number.MAX_SAFE_INTEGER;
      const bTime = b.due_date ? dayjs(b.due_date).valueOf() : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return a.card_name.localeCompare(b.card_name, "pt-BR", { sensitivity: "base" });
    });

  const payRows = db.prepare(`
    SELECT person_id, paid_cents
    FROM person_payments
    WHERE user_id = ? AND month = ? AND year = ?
  `).all(userId, month, year);
  const payByPerson = new Map(payRows.map(row => [row.person_id, row.paid_cents]));

  const personPanel = people.map(person => ({
    person_id: person.id,
    person_name: person.name,
    total_cents: personTotalsMap.get(person.id) || 0,
    paid_cents: payByPerson.get(person.id) || 0,
    active: person.active
  }));

  res.render("summary", { month, year, people, cards, rows, unassigned, cardsPanel, personPanel, formatBRLFromCents, isClosed });
});

app.post("/summary/:year/:month/cards", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;
  if (isMonthClosed(userId, month, year)) {
    setFlash(req, "error", getMonthLockMessage(month, year));
    return res.redirect(`/summary/${year}/${month}`);
  }

  const cardIds = Array.isArray(req.body.card_id) ? req.body.card_id : [req.body.card_id];
  const paid = Array.isArray(req.body.paid) ? req.body.paid : [req.body.paid];
  const overrideDue = Array.isArray(req.body.override_due) ? req.body.override_due : [req.body.override_due];
  const entries = cardIds.map((card_id, index) => ({
    card_id,
    paid: paid[index],
    override_due: overrideDue[index]
  }));

  upsertCardStatementsForMonth(userId, month, year, entries);
  res.redirect(`/summary/${year}/${month}`);
});

app.post("/summary/:year/:month/cards/async", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).json({ ok: false, error: "Mês/ano inválidos." });
  const { month, year } = parsed;
  if (isMonthClosed(userId, month, year)) {
    return res.status(423).json({ ok: false, error: getMonthLockMessage(month, year) });
  }

  upsertCardStatementsForMonth(userId, month, year, [{
    card_id: req.body.card_id,
    paid: req.body.paid,
    override_due: req.body.override_due
  }]);

  return res.json({ ok: true });
});

app.post("/summary/:year/:month/people", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;
  if (isMonthClosed(userId, month, year)) {
    setFlash(req, "error", getMonthLockMessage(month, year));
    return res.redirect(`/summary/${year}/${month}`);
  }

  const personIds = Array.isArray(req.body.person_id) ? req.body.person_id : [req.body.person_id];
  const paid = Array.isArray(req.body.paid) ? req.body.paid : [req.body.paid];
  const entries = personIds.map((person_id, index) => ({ person_id, paid: paid[index] }));

  upsertPersonPaymentsForMonth(userId, month, year, entries);
  res.redirect(`/summary/${year}/${month}`);
});

app.post("/summary/:year/:month/people/async", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).json({ ok: false, error: "Mês/ano inválidos." });
  const { month, year } = parsed;
  if (isMonthClosed(userId, month, year)) {
    return res.status(423).json({ ok: false, error: getMonthLockMessage(month, year) });
  }

  upsertPersonPaymentsForMonth(userId, month, year, [{ person_id: req.body.person_id, paid: req.body.paid }]);
  return res.json({ ok: true });
});

function getPersonStatementExportData(userId, month, year, personId) {
  syncRecurringTransactions(userId, year, month);

  const person = db.prepare("SELECT * FROM people WHERE id = ? AND user_id = ?").get(personId, userId);
  if (!person) return null;

  const items = db.prepare(`
    SELECT t.txn_date, t.description, c.name AS card_name, a.share_cents
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
      AND (
        (i.month = ? AND i.year = ?) OR
        (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
      )
    ORDER BY t.txn_date IS NULL ASC, t.txn_date DESC, c.name ASC, t.id DESC
  `).all(userId, personId, month, year, month, year);

  const totalsByCard = db.prepare(`
    SELECT c.name AS card_name, COALESCE(SUM(a.share_cents), 0) AS total_cents
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
      AND (
        (i.month = ? AND i.year = ?) OR
        (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
      )
    GROUP BY c.id
    ORDER BY c.name
  `).all(userId, personId, month, year, month, year);

  const total = totalsByCard.reduce((acc, r) => acc + r.total_cents, 0);

  const paymentRow = db.prepare(`
    SELECT paid_cents
    FROM person_payments
    WHERE user_id = ? AND person_id = ? AND month = ? AND year = ?
  `).get(userId, personId, month, year);

  const paid_cents = paymentRow ? paymentRow.paid_cents : 0;
  const remaining_cents = Math.max(0, total - paid_cents);

  return { person, items, totalsByCard, total, paid_cents, remaining_cents };
}

// WhatsApp e compartilhamento
app.get("/share/:year/:month/:personId", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  const personId = Number(req.params.personId);
  if (!parsed) return res.status(400).send("Parâmetros inválidos.");

  const { month, year } = parsed;
  const exportData = getPersonStatementExportData(userId, month, year, personId);
  if (!exportData) return res.status(400).send("Pessoa inválida.");

  res.render("share", { month, year, ...exportData, formatBRLFromCents });
});

app.get("/whatsapp/:year/:month/:personId", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  const personId = Number(req.params.personId);
  if (!parsed) return res.status(400).send("Parâmetros inválidos.");

  if (!isAdminUser(userId)) {
    setFlash(req, "error", "O envio via WhatsApp está disponível apenas para administradores.");
    return res.redirect(`/share/${req.params.year}/${req.params.month}/${personId}`);
  }

  const { month, year } = parsed;
  const exportData = getPersonStatementExportData(userId, month, year, personId);
  if (!exportData) return res.status(400).send("Pessoa inválida.");

  res.render("whatsapp", { month, year, ...exportData, formatBRLFromCents });
});

app.post("/whatsapp/send-automation", ensureAuthenticated, express.json({ limit: '10mb' }), async (req, res) => {
  if (!isAdminUser(req.user.id)) {
    return res.status(403).json({ error: "O envio via WhatsApp está disponível apenas para administradores." });
  }

  try {
    const { personPhone, message, imageBase64 } = req.body;

    const apiUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    const instance = process.env.EVOLUTION_INSTANCE_NAME;

    if (!apiUrl || !apiKey || !instance) {
      return res.status(400).json({ error: "Configurações da Evolution API não encontradas." });
    }

    const cleanNumber = String(personPhone || '').replace(/\D/g, '');
    const base64Data = String(imageBase64 || '').split(',')[1];
    await axios.post(`${apiUrl}/message/sendMedia/${instance}`, {
      number: cleanNumber,
      mediatype: "image",
      media: base64Data,
      caption: message,
      delay: 1200
    }, { headers: { apikey: apiKey } });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Falha ao enviar imagem via WhatsApp" });
  }
});
// --- ROTAS DO detalhamento ---

// 1. Adiciona nova linha (Tanto para Entradas quanto para Contas)
app.post("/finances/add-row", ensureAuthenticated, express.json(), (req, res) => {
  const userId = req.user.id;

  try {
    const { month, year, type, description } = req.body;
    if (isMonthClosed(userId, Number(month), Number(year))) {
      return res.status(423).json({ error: getMonthLockMessage(Number(month), Number(year)) });
    }
    db.prepare(`
      INSERT INTO monthly_finances (user_id, month, year, type, description, formula, amount_cents, created_at)
      VALUES (?, ?, ?, ?, ?, '', 0, ?)
    `).run(userId, month, year, type, description, new Date().toISOString());

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Atualiza texto ou valor/fórmula de uma linha
app.post("/finances/update/:id", ensureAuthenticated, express.json(), (req, res) => {
  const userId = req.user.id;

  try {
    const id = req.params.id;
    const { field, value, formula, amount_cents } = req.body;
    const row = db.prepare("SELECT month, year FROM monthly_finances WHERE id = ? AND user_id = ?").get(id, userId);
    if (!row) {
      return res.status(404).json({ error: "Linha não encontrada." });
    }
    if (isMonthClosed(userId, Number(row.month), Number(row.year))) {
      return res.status(423).json({ error: getMonthLockMessage(Number(row.month), Number(row.year)) });
    }

    if (field === 'description') {
      db.prepare("UPDATE monthly_finances SET description = ? WHERE id = ? AND user_id = ?").run(value, id, userId);
    } else if (field === 'formula_and_value') {
      db.prepare("UPDATE monthly_finances SET formula = ?, amount_cents = ? WHERE id = ? AND user_id = ?").run(formula, amount_cents, id, userId);
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Deleta uma linha (Entrada ou Conta)
app.post("/finances/delete/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const row = db.prepare("SELECT month, year FROM monthly_finances WHERE id = ? AND user_id = ?").get(req.params.id, userId);
  if (!row) {
    return res.status(404).json({ error: "Linha não encontrada." });
  }
  if (isMonthClosed(userId, Number(row.month), Number(row.year))) {
    return res.status(423).json({ error: getMonthLockMessage(Number(row.month), Number(row.year)) });
  }
  db.prepare("DELETE FROM monthly_finances WHERE id = ? AND user_id = ?").run(req.params.id, userId);
  res.json({ success: true });
});

// 4. Salva Lembretes e Calculadora
app.post("/finances/notes/:year/:month", ensureAuthenticated, express.json(), (req, res) => {
  const userId = req.user.id;

  try {
    const { year, month } = req.params;
    const { type, content } = req.body;
    if (isMonthClosed(userId, Number(month), Number(year))) {
      return res.status(423).json({ error: getMonthLockMessage(Number(month), Number(year)) });
    }
    const column = type === 'math' ? 'content_math' : 'content_text';

    const existing = db.prepare("SELECT 1 FROM scratchpad WHERE user_id = ? AND month = ? AND year = ?").get(userId, month, year);
    if (existing) {
      db.prepare(`UPDATE scratchpad SET ${column} = ? WHERE user_id = ? AND month = ? AND year = ?`).run(content, userId, month, year);
    } else {
      const mathVal = type === 'math' ? content : '';
      const textVal = type === 'text' ? content : '';
      db.prepare(`INSERT INTO scratchpad (user_id, month, year, content_math, content_text) VALUES (?, ?, ?, ?, ?)`).run(userId, month, year, mathVal, textVal);
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tranca ou Destranca um mês
app.post("/finances/toggle-close", ensureAuthenticated, express.json(), (req, res) => {
  const userId = req.user.id;

  try {
    const { month, year, status } = req.body;
    if (status === 'close') {
      db.prepare("INSERT OR IGNORE INTO closed_months (user_id, month, year) VALUES (?, ?, ?)").run(userId, month, year);
    } else {
      db.prepare("DELETE FROM closed_months WHERE user_id = ? AND month = ? AND year = ?").run(userId, month, year);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== PÁGINA DE ADMIN (GERENCIAR USUÁRIOS) =====
app.get("/admin", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;

  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado. Apenas administradores podem acessar esta página.');
  }

  return renderAdmin(res);
});

app.post("/admin/add-user", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const { email, name, role } = req.body;
  const canImport = req.body.can_import ? 1 : 0;

  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  if (!email || !email.includes('@')) {
    return renderAdmin(res, { error: 'Email inválido' });
  }

  try {
    db.prepare("INSERT INTO users (email, name, role, can_import, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(email, name || email.split('@')[0], role || 'user', canImport, dayjs().toISOString());

    const newUser = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    const insertCat = db.prepare("INSERT OR IGNORE INTO finance_categories (user_id, name) VALUES (?, ?)");
    DEFAULT_FINANCE_CATEGORIES.forEach(cat => insertCat.run(newUser.id, cat));

    return renderAdmin(res, { success: `Usuário ${email} adicionado com sucesso!` });
  } catch (err) {
    return renderAdmin(res, { error: err.message });
  }
});

app.post("/admin/remove-user/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const targetUserId = req.params.id;

  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  if (String(userId) === String(targetUserId)) {
    return renderAdmin(res, { error: 'Você não pode remover sua própria conta' });
  }

  try {
    const tables = ['allocations', 'transactions', 'imports', 'person_payments', 'card_statements', 'people', 'cards', 'monthly_finances', 'scratchpad', 'finance_categories', 'closed_months'];

    for (const table of tables) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(targetUserId);
    }

    db.prepare("DELETE FROM users WHERE id = ?").run(targetUserId);

    return renderAdmin(res, { success: 'Usuário removido com sucesso!' });
  } catch (err) {
    return renderAdmin(res, { error: err.message });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`✅ Rodando em http://localhost:${PORT}`);
});
