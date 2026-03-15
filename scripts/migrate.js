const db = require("../src/db");

function columnExists(table, col) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  return cols.includes(col);
}

// ===== TABELA DE USUÁRIOS (NOVA) =====
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  google_id TEXT UNIQUE,
  role TEXT DEFAULT 'user',
  created_at TEXT NOT NULL,
  last_login TEXT
);
`);

// ===== TABELAS EXISTENTES COM user_id =====
db.exec(`
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  due_day INTEGER,
  close_day INTEGER,
  holiday_scope TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  UNIQUE(user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  is_owner INTEGER DEFAULT 0,
  created_at TEXT,
  UNIQUE(user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  card_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  original_filename TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  import_id INTEGER,
  card_id INTEGER NOT NULL,
  txn_date TEXT,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  card_number TEXT,
  raw_json TEXT,
  due_month INTEGER,
  due_year INTEGER,
  parent_txn_id INTEGER,
  recurring_rule_id INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (import_id) REFERENCES imports(id),
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  transaction_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  share_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(transaction_id, person_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS card_statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  card_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  computed_due_date TEXT,
  override_due_date TEXT,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(card_id, month, year),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS person_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(person_id, month, year),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS finance_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  UNIQUE(user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS monthly_finances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  type TEXT NOT NULL,
  category_id INTEGER,
  description TEXT,
  formula TEXT,
  amount_cents INTEGER DEFAULT 0,
  created_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (category_id) REFERENCES finance_categories(id)
);

CREATE TABLE IF NOT EXISTS scratchpad (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  content_text TEXT,
  content_math TEXT,
  UNIQUE(user_id, month, year),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS closed_months (
  user_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  PRIMARY KEY (user_id, month, year),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

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
  ended_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS recurring_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  rule_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, rule_id, month, year),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (rule_id) REFERENCES recurring_rules(id)
);
`);

// ===== ÍNDICES =====
db.exec(`
CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);
CREATE INDEX IF NOT EXISTS idx_people_user ON people(user_id);
CREATE INDEX IF NOT EXISTS idx_imports_user ON imports(user_id);
CREATE INDEX IF NOT EXISTS idx_txn_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_txn_card ON transactions(card_id);
CREATE INDEX IF NOT EXISTS idx_txn_import ON transactions(import_id);
CREATE INDEX IF NOT EXISTS idx_alloc_user ON allocations(user_id);
CREATE INDEX IF NOT EXISTS idx_alloc_txn ON allocations(transaction_id);
CREATE INDEX IF NOT EXISTS idx_statements_user ON card_statements(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON person_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_txn_recurring_rule ON transactions(recurring_rule_id);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_user_status ON recurring_rules(user_id, status);
CREATE INDEX IF NOT EXISTS idx_recurring_exceptions_rule_month ON recurring_exceptions(user_id, rule_id, year, month);
`);

if (!columnExists("cards", "active")) {
  db.exec("ALTER TABLE cards ADD COLUMN active INTEGER NOT NULL DEFAULT 1;");
}

if (!columnExists("cards", "close_day")) {
  db.exec("ALTER TABLE cards ADD COLUMN close_day INTEGER;");
}

if (!columnExists("transactions", "recurring_rule_id")) {
  db.exec("ALTER TABLE transactions ADD COLUMN recurring_rule_id INTEGER;");
}

// ===== CATEGORIAS PADRÃO =====
// Nota: Categorias agora são por usuário, então não inserimos padrão aqui
// Cada usuário terá suas categorias criadas na primeira vez que acessar

console.log("✅ Migração Multi-Usuário concluída!");
console.log("✅ Tabela de usuários criada");
console.log("✅ user_id adicionado a todas as tabelas");
