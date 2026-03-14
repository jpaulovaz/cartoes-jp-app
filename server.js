require('dotenv').config(); // Carrega as variáveis do .env
const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require('axios');
const dayjs = require("dayjs");

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
try { db.prepare("ALTER TABLE cards ADD COLUMN close_day INTEGER").run(); } catch (e) { }

// Adiciona a coluna de telefone na tabela people se ela não existir
try { db.prepare("ALTER TABLE people ADD COLUMN phone TEXT").run(); } catch (e) { /* Coluna já existe */ }

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
try { db.prepare("ALTER TABLE closed_months ADD COLUMN user_id INTEGER").run(); } catch (e) { /* Coluna já existe ou tabela ainda não precisava de ajuste */ }
try { db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_closed_months_user_month_year ON closed_months(user_id, month, year)").run(); } catch (e) { /* Índice já existe */ }

const { parseCsvByCardName } = require("./src/importers");
const { formatBRLFromCents, parseMonthYear, toISOFromBRDate, centsFromPtBrMoney } = require("./src/utils");
const formatDateBR = (dateStr) => { if (!dateStr) return "-"; return dayjs(dateStr).format("DD/MM/YYYY"); };
const { computeDueDate } = require("./src/dueDate");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const DEFAULT_FINANCE_CATEGORIES = ['Prestação Apartamento', 'Luz', 'Internet', 'Condomínio', 'Tim'];

function getUserRecord(userId) {
  return db.prepare("SELECT id, email, name, role, created_at, last_login FROM users WHERE id = ?").get(userId);
}

function getAllUsers() {
  return db.prepare("SELECT id, email, name, role, created_at, last_login FROM users ORDER BY created_at DESC").all();
}

function isAdminUser(userId) {
  return getUserRecord(userId)?.role === 'admin';
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
    title: 'Cartões JP | Administração',
    users: getAllUsers(),
    error,
    success
  });
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
      role: authorizedUser.role
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

// ===== ROTAS DE AUTH =====
app.get('/login', (req, res) => {
  res.render('login_oauth', { error: null });
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
  res.locals.nomeTitular = "Detalhamento Contas";
  res.locals.formatDateBR = formatDateBR;
  res.locals.flash = null;

  if (req.isAuthenticated() && req.user?.id) {
    const currentUser = getUserRecord(req.user.id);

    if (currentUser) {
      req.user.email = currentUser.email || req.user.email;
      req.user.name = currentUser.name || req.user.name || currentUser.email;
      req.user.role = currentUser.role;
    }

    res.locals.user = req.user;
    res.locals.userId = req.user.id;
    res.locals.isAdmin = req.user.role === 'admin';

    try {
      const owner = db.prepare("SELECT name FROM people WHERE user_id = ? AND is_owner = 1 LIMIT 1").get(req.user.id);
      res.locals.nomeTitular = owner ? `Detalhamento ${owner.name}` : "Detalhamento Contas";
    } catch (e) {
      res.locals.nomeTitular = "Detalhamento Contas";
    }
  }

  next();
});

function nowIso() { return dayjs().toISOString(); }

function normalizeDayOfMonth(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 31) return null;
  return num;
}

function computeSuggestedFirstDue(dateStr, closeDay) {
  const parsedDate = dayjs(dateStr);
  if (!parsedDate.isValid()) return null;

  const normalizedCloseDay = normalizeDayOfMonth(closeDay);
  const suggestedBase = normalizedCloseDay && parsedDate.date() >= normalizedCloseDay
    ? parsedDate.add(1, 'month')
    : parsedDate;

  return suggestedBase.format('YYYY-MM');
}

function getCards(userId) {
  return db.prepare("SELECT id, name, due_day, close_day, holiday_scope FROM cards WHERE user_id = ? ORDER BY name").all(userId);
}

function getPeopleAll(userId) {
  return db.prepare("SELECT id, name, active FROM people WHERE user_id = ? ORDER BY active DESC, name").all(userId);
}

function getPeopleActive(userId) {
  return db.prepare("SELECT id, name FROM people WHERE user_id = ? AND active=1 ORDER BY name").all(userId);
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

  const d = new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  res.redirect(`/detalhamento/${year}/${month}`);
});

app.get("/geral", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;

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
      remaining_cents: Math.max(0, group.total_cents - paid_cents)
    };
  });

  const sortDesc = (a, b) => (b.year !== a.year) ? b.year - a.year : b.month - a.month;
  const sortAsc = (a, b) => (a.year !== b.year) ? a.year - b.year : a.month - b.month;

  groupedRecent.sort(sortDesc);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const currentOrNextGroup = groupedRecent
    .filter(group => group.year > currentYear || (group.year === currentYear && group.month >= currentMonth))
    .sort(sortAsc)[0] || null;

  const groupedRecentFinal = currentOrNextGroup
    ? [
      currentOrNextGroup,
      ...groupedRecent
        .filter(group => !(group.year === currentOrNextGroup.year && group.month === currentOrNextGroup.month))
        .sort(sortDesc)
    ]
    : groupedRecent.sort(sortDesc);

  const cards = getCards(userId);

  res.render("home", {
    groupedRecent: groupedRecentFinal,
    formatBRLFromCents,
    cards,
    user: req.user || req.session.user
  });
});

// People
app.get("/people", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const people = db.prepare("SELECT * FROM people WHERE user_id = ? ORDER BY name ASC").all(userId);
  res.render("people", { people, title: "Pessoas" });
});

app.post("/people", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const name = (req.body.name || "").trim();
  const phone = (req.body.phone || "").trim().replace(/\D/g, '');
  const id = Number(req.body.id) || null;

  if (id) {
    db.prepare("UPDATE people SET name = ?, phone = ? WHERE id = ? AND user_id = ?").run(name, phone, id, userId);
  } else if (name) {
    db.prepare("INSERT OR IGNORE INTO people(user_id, name, phone, active) VALUES (?, ?, ?, 1)").run(userId, name, phone);
  }

  res.redirect("/people");
});

app.post("/people/:id/toggle", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  db.prepare("UPDATE people SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ? AND user_id = ?")
    .run(Number(req.params.id), userId);
  res.redirect("/people");
});

// Cards
app.get("/cards", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  res.render("cards", { cards: getCards(userId) });
});

app.post("/cards", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const name = (req.body.name || "").trim();
  const dueDay = normalizeDayOfMonth(req.body.due_day);
  const closeDay = normalizeDayOfMonth(req.body.close_day);

  if (name) {
    db.prepare("INSERT OR IGNORE INTO cards(user_id, name, due_day, close_day, holiday_scope) VALUES (?, ?, ?, ?, ?)")
      .run(userId, name, dueDay, closeDay, "BR");
  }

  res.redirect("/cards");
});

app.post("/cards/:id/update", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  db.prepare("UPDATE cards SET due_day = ?, close_day = ? WHERE id = ? AND user_id = ?")
    .run(normalizeDayOfMonth(req.body.due_day), normalizeDayOfMonth(req.body.close_day), Number(req.params.id), userId);
  res.redirect("/cards");
});

// Import
app.get("/import", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  res.render("import", { cards: getCards(userId), error: null });
});

app.post("/import", ensureAuthenticated, upload.single("csvfile"), (req, res) => {
  const userId = req.user.id;
  const cards = getCards(userId);

  try {
    const cardId = Number(req.body.card_id);
    const month = Number(req.body.month);
    const year = Number(req.body.year);

    if (!req.file) throw new Error("Envie um arquivo CSV.");
    if (!cardId) throw new Error("Selecione o cartão.");
    if (!month || month < 1 || month > 12) throw new Error("Mês inválido.");
    if (!year || year < 2000 || year > 2100) throw new Error("Ano inválido.");

    const card = db.prepare("SELECT id, name FROM cards WHERE id = ? AND user_id = ?").get(cardId, userId);
    if (!card) throw new Error("Cartão inválido.");

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

  // ================================================================
  // NOVA LÓGICA: CLONAR CONTAS FIXAS DO MÊS ANTERIOR
  // ================================================================
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
  // ================================================================

  // 1. Busca o titular do usuário logado
  const owner = db.prepare("SELECT * FROM people WHERE user_id = ? AND is_owner = 1 LIMIT 1").get(userId);
  if (!owner) return res.status(400).send("Defina um titular na aba Pessoas primeiro.");

  // 2. Calcula total de cartões do titular para o mês (incluindo transações manuais)
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

  // 3. Busca entradas e gastos fixos do usuário
  const finances = db.prepare(`
    SELECT *
    FROM monthly_finances
    WHERE user_id = ? AND month = ? AND year = ?
  `).all(userId, currentMonth, currentYear);

  const categories = db.prepare("SELECT * FROM finance_categories WHERE user_id = ? AND is_active = 1").all(userId);

  // 4. Busca bloco de notas
  let notes = db.prepare("SELECT * FROM scratchpad WHERE user_id = ? AND month = ? AND year = ?").get(userId, currentMonth, currentYear);
  if (!notes) {
    db.prepare("INSERT INTO scratchpad (user_id, month, year, content_text, content_math) VALUES (?, ?, ?, '', '')")
      .run(userId, currentMonth, currentYear);
    notes = { content_text: '', content_math: '' };
  }

  // Verifica se o mês está trancado
  const closedCheck = db.prepare("SELECT 1 FROM closed_months WHERE user_id = ? AND month = ? AND year = ?")
    .get(userId, currentMonth, currentYear);
  const isClosed = !!closedCheck;

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
    isClosed
  });
});

app.get("/month/:year/:month", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;

  const sort = (req.query.sort || "date").toString();
  const dir = (req.query.dir || "asc").toString();
  const orderBy = buildOrder(sort, dir);

  const filters = {
    f_date: (req.query.f_date || "").toString().trim(),
    f_desc: (req.query.f_desc || "").toString().trim(),
    f_card: (req.query.f_card || "").toString().trim(),
    f_number: (req.query.f_number || "").toString().trim(),
    f_amount: (req.query.f_amount || "").toString().trim(),
    f_allocated: (req.query.f_allocated || "").toString().trim()
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
    const s = filters.f_amount.replace(/\s+/g, "");
    where.push("(CAST(ABS(t.amount_cents) AS TEXT) LIKE ? OR CAST(ABS(t.amount_cents) / 100.0 AS TEXT) LIKE ?)");
    params.push(likeParam(s.replace(/[.,]/g, "")));
    params.push(likeParam(s.replace(",", ".")));
  }

  if (filters.f_allocated) {
    const f = filters.f_allocated.toLowerCase();
    if (f.startsWith("s")) where.push(`${allocCountExpr} > 0`);
    else if (f.startsWith("n")) where.push(`${allocCountExpr} = 0`);
  }

  const txns = db.prepare(`
    SELECT t.id, t.txn_date, t.description, t.amount_cents, t.card_number, c.name AS card_name,
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
  });

  const people = getPeopleActive(userId);
  const cards = getCards(userId);
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

  res.render("month", { month, year, txns, people, cards, formatBRLFromCents, sort, dir, sortLink, filters });
});

app.post("/txn/manual", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const { date, description, amount, card_id, first_due, installments } = req.body;

  try {
    const cardIdNum = Number(card_id);
    if (!cardIdNum || isNaN(cardIdNum)) {
      return res.status(400).send("Cartao invalido. Selecione um cartao valido.");
    }

    const cardExists = db.prepare("SELECT id, close_day FROM cards WHERE id = ? AND user_id = ?").get(cardIdNum, userId);
    if (!cardExists) {
      return res.status(400).send("Cartao nao encontrado no sistema.");
    }

    const totalCents = centsFromPtBrMoney(amount);
    const numInstallments = parseInt(installments) || 1;
    const installmentValue = Math.floor(totalCents / numInstallments);
    const remainder = totalCents % numInstallments;

    const suggestedFirstDue = computeSuggestedFirstDue(date, cardExists.close_day);
    const firstDueValue = String(first_due || "").trim() || suggestedFirstDue;
    if (!/^\d{4}-\d{2}$/.test(firstDueValue || "")) {
      return res.status(400).send("Primeiro vencimento invalido.");
    }

    let [startYear, startMonth] = firstDueValue.split('-').map(Number);

    db.transaction(() => {
      const activePeople = db.prepare("SELECT id FROM people WHERE user_id = ? AND active = 1").all(userId);
      const insTxn = db.prepare(`
        INSERT INTO transactions (user_id, card_id, txn_date, description, amount_cents, due_month, due_year, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insAlloc = db.prepare(`
        INSERT INTO allocations (user_id, transaction_id, person_id, share_cents, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < numInstallments; i++) {
        let currentMonth = startMonth + i;
        let currentYear = startYear;
        while (currentMonth > 12) { currentMonth -= 12; currentYear += 1; }

        const finalDesc = numInstallments > 1
          ? `${description} (${String(i + 1).padStart(2, '0')}/${String(numInstallments).padStart(2, '0')})`
          : description;

        const currentAmount = (i === numInstallments - 1) ? installmentValue + remainder : installmentValue;

        const info = insTxn.run(userId, cardIdNum, date, finalDesc, currentAmount, currentMonth, currentYear, new Date().toISOString());

        if (activePeople.length === 1) {
          insAlloc.run(userId, info.lastInsertRowid, activePeople[0].id, currentAmount, new Date().toISOString());
        }
      }
    })();

    res.redirect(`/month/${startYear}/${startMonth}`);
  } catch (err) {
    res.status(500).send("Erro ao processar transacao manual: " + err.message);
  }
});

app.post("/txn/:id/alloc", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);

  const txn = db.prepare(`
    SELECT t.id, t.amount_cents, COALESCE(i.month, t.due_month) as month, COALESCE(i.year, t.due_year) as year
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.id = ? AND t.user_id = ?
  `).get(id, userId);

  if (!txn) return res.status(404).send("Transação não encontrada.");

  let personIds = req.body.person_ids || [];
  if (!Array.isArray(personIds)) personIds = [personIds];
  const validPeople = new Set(getPeopleAll(userId).map(p => p.id));
  personIds = personIds.map(Number).filter(pid => validPeople.has(pid));

  const del = db.prepare("DELETE FROM allocations WHERE transaction_id = ? AND user_id = ?");
  const ins = db.prepare("INSERT INTO allocations(user_id, transaction_id, person_id, share_cents, created_at) VALUES (?, ?, ?, ?, ?)");

  db.transaction(() => {
    del.run(id, userId);
    if (personIds.length > 0) {
      const share = Math.floor(txn.amount_cents / personIds.length);
      const remainder = txn.amount_cents - (share * personIds.length);
      personIds.forEach((pid, idx) => {
        const s = share + (idx < Math.abs(remainder) ? Math.sign(remainder) : 0);
        ins.run(userId, id, pid, s, nowIso());
      });
    }
  })();

  res.redirect(`/month/${txn.year}/${txn.month}`);
});

// Detail page
app.get("/txn/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);
  const txn = db.prepare(`
    SELECT t.id, t.txn_date, t.description, t.amount_cents, t.card_number, c.name AS card_name,
           COALESCE(t.due_month, i.month) as month,
           COALESCE(t.due_year, i.year) as year
    FROM transactions t
    LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.id = ? AND t.user_id = ?
  `).get(id, userId);

  if (!txn) return res.status(404).send("Transação não encontrada.");

  const people = getPeopleActive(userId);
  const selected = db.prepare("SELECT person_id FROM allocations WHERE transaction_id = ? AND user_id = ?")
    .all(id, userId)
    .map(r => r.person_id);

  res.render("txn", { txn, people, selected, formatBRLFromCents });
});

app.post("/txn/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);

  const txn = db.prepare(`
    SELECT t.id, t.amount_cents,
           COALESCE(i.month, t.due_month) as month,
           COALESCE(i.year, t.due_year) as year
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.id = ? AND t.user_id = ?
  `).get(id, userId);

  if (!txn) return res.status(404).send("Transação não encontrada.");

  let personIds = req.body.person_ids || [];
  if (!Array.isArray(personIds)) personIds = [personIds];
  const validPeople = new Set(getPeopleAll(userId).map(p => p.id));
  personIds = personIds.map(Number).filter(pid => validPeople.has(pid));

  const del = db.prepare("DELETE FROM allocations WHERE transaction_id = ? AND user_id = ?");
  const ins = db.prepare("INSERT INTO allocations(user_id, transaction_id, person_id, share_cents, created_at) VALUES (?, ?, ?, ?, ?)");

  db.transaction(() => {
    del.run(id, userId);
    if (personIds.length > 0) {
      const share = Math.floor(txn.amount_cents / personIds.length);
      const remainder = txn.amount_cents - (share * personIds.length);
      personIds.forEach((pid, idx) => {
        const s = share + (idx < Math.abs(remainder) ? Math.sign(remainder) : 0);
        ins.run(userId, id, pid, s, nowIso());
      });
    }
  })();

  res.redirect(`/month/${txn.year}/${txn.month}`);
});

// Summary (minimal)
app.get("/summary/:year/:month", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;

  const people = getPeopleActive(userId);
  const cards = getCards(userId);

  const rows = db.prepare(`
    SELECT p.id AS person_id, p.name AS person_name, c.id AS card_id, c.name AS card_name,
           COALESCE(alloc.total_cents, 0) AS total_cents
    FROM people p
    CROSS JOIN cards c
    LEFT JOIN (
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
    ) alloc ON alloc.person_id = p.id AND alloc.card_id = c.id
    WHERE p.user_id = ? AND c.user_id = ? AND p.active = 1
    ORDER BY p.name, c.name
  `).all(userId, month, year, month, year, userId, userId);

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

  const cardTotals = db.prepare(`
    SELECT c.id AS card_id, c.name AS card_name, c.due_day, c.holiday_scope,
           COALESCE(curr.total_cents, 0) AS total_cents
    FROM cards c
    LEFT JOIN (
      SELECT t.card_id, SUM(t.amount_cents) AS total_cents
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      WHERE t.user_id = ?
        AND (
          (i.month = ? AND i.year = ?) OR
          (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
        )
      GROUP BY t.card_id
    ) curr ON curr.card_id = c.id
    WHERE c.user_id = ?
    ORDER BY c.name
  `).all(userId, month, year, month, year, userId);

  const stmtRows = db.prepare(`
    SELECT card_id, computed_due_date, override_due_date, paid_cents
    FROM card_statements
    WHERE user_id = ? AND month = ? AND year = ?
  `).all(userId, month, year);
  const stmtByCard = new Map(stmtRows.map(r => [r.card_id, r]));

  const cardsPanel = cardTotals.map(ct => {
    const stmt = stmtByCard.get(ct.card_id);
    const computed = computeDueDate({ year, month, dueDay: ct.due_day, holidayScope: ct.holiday_scope || "BR" });
    const due_date = stmt?.override_due_date || stmt?.computed_due_date || computed;
    return {
      card_id: ct.card_id,
      card_name: ct.card_name,
      computed_due_date: computed,
      due_date,
      paid_cents: stmt ? stmt.paid_cents : 0,
      total_cents: ct.total_cents
    };
  });

  const personTotals = db.prepare(`
    SELECT p.id AS person_id, p.name AS person_name,
           COALESCE(alloc.total_cents, 0) AS total_cents
    FROM people p
    LEFT JOIN (
      SELECT a.person_id, SUM(a.share_cents) AS total_cents
      FROM allocations a
      JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      WHERE a.user_id = ?
        AND (
          (i.month = ? AND i.year = ?) OR
          (t.import_id IS NULL AND t.due_month = ? AND t.due_year = ?)
        )
      GROUP BY a.person_id
    ) alloc ON alloc.person_id = p.id
    WHERE p.user_id = ? AND p.active = 1
    ORDER BY p.name
  `).all(userId, month, year, month, year, userId);

  const payRows = db.prepare(`
    SELECT person_id, paid_cents
    FROM person_payments
    WHERE user_id = ? AND month = ? AND year = ?
  `).all(userId, month, year);
  const payByPerson = new Map(payRows.map(r => [r.person_id, r.paid_cents]));

  const personPanel = personTotals.map(pt => ({
    person_id: pt.person_id,
    person_name: pt.person_name,
    total_cents: pt.total_cents,
    paid_cents: payByPerson.get(pt.person_id) || 0
  }));

  res.render("summary", { month, year, people, cards, rows, unassigned, cardsPanel, personPanel, formatBRLFromCents });
});

app.post("/summary/:year/:month/cards", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;

  const cardIds = Array.isArray(req.body.card_id) ? req.body.card_id : [req.body.card_id];
  const paid = Array.isArray(req.body.paid) ? req.body.paid : [req.body.paid];
  const overrideDue = Array.isArray(req.body.override_due) ? req.body.override_due : [req.body.override_due];
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

  db.transaction(() => {
    for (let i = 0; i < cardIds.length; i++) {
      const card_id = Number(cardIds[i]);
      if (!card_id || !cardsById.has(card_id)) continue;

      const paid_cents = centsFromPtBrMoney(paid[i]);
      const override_due_date = (overrideDue[i] || "").toString().trim() || null;
      const card = cardsById.get(card_id);
      const computed_due_date = computeDueDate({ year, month, dueDay: card?.due_day, holidayScope: card?.holiday_scope || "BR" });
      const now = nowIso();

      const existing = findStatement.get(userId, card_id, month, year);
      if (existing) {
        updateStatement.run(computed_due_date, override_due_date, paid_cents, now, userId, card_id, month, year);
      } else {
        insertStatement.run(userId, card_id, month, year, computed_due_date, override_due_date, paid_cents, now, now);
      }
    }
  })();

  res.redirect(`/summary/${year}/${month}`);
});

app.post("/summary/:year/:month/people", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;

  const personIds = Array.isArray(req.body.person_id) ? req.body.person_id : [req.body.person_id];
  const paid = Array.isArray(req.body.paid) ? req.body.paid : [req.body.paid];
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

  db.transaction(() => {
    for (let i = 0; i < personIds.length; i++) {
      const person_id = Number(personIds[i]);
      if (!person_id || !validPeople.has(person_id)) continue;

      const paid_cents = centsFromPtBrMoney(paid[i]);
      const now = nowIso();
      const existing = findPayment.get(userId, person_id, month, year);

      if (existing) {
        updatePayment.run(paid_cents, now, userId, person_id, month, year);
      } else {
        insertPayment.run(userId, person_id, month, year, paid_cents, now, now);
      }
    }
  })();

  res.redirect(`/summary/${year}/${month}`);
});

// WhatsApp
app.get("/whatsapp/:year/:month/:personId", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  const personId = Number(req.params.personId);
  if (!parsed) return res.status(400).send("Parâmetros inválidos.");

  const person = db.prepare("SELECT * FROM people WHERE id = ? AND user_id = ?").get(personId, userId);
  if (!person) return res.status(400).send("Pessoa inválida.");

  const { month, year } = parsed;

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
    ORDER BY t.txn_date IS NULL, t.txn_date, c.name, t.id
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

  res.render("whatsapp", { month, year, person, items, totalsByCard, total, paid_cents, remaining_cents, formatBRLFromCents });
});

app.post("/whatsapp/send-automation", ensureAuthenticated, express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { personPhone, message, imageBase64 } = req.body;

    const apiUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    const instance = process.env.EVOLUTION_INSTANCE_NAME;

    if (!apiUrl || !apiKey || !instance) {
      return res.status(400).json({ error: "Configurações da Evolution API não encontradas." });
    }

    // Limpa o número (apenas números)
    const cleanNumber = personPhone.replace(/\D/g, '');
    const base64Data = imageBase64.split(',')[1];
    // Envia como Mídia (Imagem + Legenda)
    await axios.post(`${apiUrl}/message/sendMedia/${instance}`, {
      number: cleanNumber,
      mediatype: "image", // TUDO MINÚSCULO (O erro estava aqui)
      media: base64Data,   // Apenas a string Base64 limpa
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
  db.prepare("DELETE FROM monthly_finances WHERE id = ? AND user_id = ?").run(req.params.id, userId);
  res.json({ success: true });
});

// 4. Salva Lembretes e Calculadora
app.post("/finances/notes/:year/:month", ensureAuthenticated, express.json(), (req, res) => {
  const userId = req.user.id;

  try {
    const { year, month } = req.params;
    const { type, content } = req.body;
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

  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  if (!email || !email.includes('@')) {
    return renderAdmin(res, { error: 'Email inválido' });
  }

  try {
    db.prepare("INSERT INTO users (email, name, role, created_at) VALUES (?, ?, ?, ?)")
      .run(email, name || email.split('@')[0], role || 'user', dayjs().toISOString());

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
