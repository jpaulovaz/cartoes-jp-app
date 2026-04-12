function runMigrations() {
  const db = require('../src/db');
  const {
    ensureMessageTemplateTables,
    syncMessageCatalogWithDatabase
  } = require('../src/messageCatalog');

  function columnExists(table, col) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
    return cols.includes(col);
  }

  function tableExists(table) {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(table);
    return !!row;
  }

  function indexExists(indexName) {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1")
      .get(indexName);
    return !!row;
  }

  function ensureIndexWithAliases(sql, indexNames = []) {
    if ((indexNames || []).some((indexName) => indexExists(indexName))) {
      return;
    }
    db.exec(sql);
  }

  // ===== TABELA DE USUÁRIOS (NOVA) =====
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    google_id TEXT UNIQUE,
    role TEXT DEFAULT 'user',
    can_import INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    deleted_at TEXT,
    deleted_label TEXT,
    google_photo_url TEXT,
    profile_photo_url TEXT,
    created_at TEXT NOT NULL,
    last_login TEXT,
    last_seen_at TEXT
  );
  `);

  if (!columnExists("users", "can_import")) {
    db.exec("ALTER TABLE users ADD COLUMN can_import INTEGER NOT NULL DEFAULT 1;");
  }

  if (!columnExists("users", "status")) {
    db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';");
  }

  if (!columnExists("users", "deleted_at")) {
    db.exec("ALTER TABLE users ADD COLUMN deleted_at TEXT;");
  }

  if (!columnExists("users", "deleted_label")) {
    db.exec("ALTER TABLE users ADD COLUMN deleted_label TEXT;");
  }

  if (!columnExists("users", "profile_photo_url")) {
    db.exec("ALTER TABLE users ADD COLUMN profile_photo_url TEXT;");
  }

  if (!columnExists("users", "google_photo_url")) {
    db.exec("ALTER TABLE users ADD COLUMN google_photo_url TEXT;");
  }

  if (!columnExists("users", "profile_photo_mode")) {
    db.exec("ALTER TABLE users ADD COLUMN profile_photo_mode TEXT NOT NULL DEFAULT 'default';");
  }

  if (!columnExists("users", "last_seen_at")) {
    db.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT;");
  }

  if (!columnExists("users", "profile_signature_text")) {
    db.exec("ALTER TABLE users ADD COLUMN profile_signature_text TEXT;");
  }

  if (!columnExists("users", "profile_signature_vibe")) {
    db.exec("ALTER TABLE users ADD COLUMN profile_signature_vibe TEXT;");
  }

  if (!columnExists("users", "profile_signature_updated_at")) {
    db.exec("ALTER TABLE users ADD COLUMN profile_signature_updated_at TEXT;");
  }

  // ===== SEGURANCA DO APP =====
  db.exec(`
  CREATE TABLE IF NOT EXISTS user_security_settings (
    user_id INTEGER PRIMARY KEY,
    pin_enabled INTEGER NOT NULL DEFAULT 0,
    pin_hash TEXT,
    pin_salt TEXT,
    pin_kdf TEXT NOT NULL DEFAULT 'scrypt-v1',
    pin_idle_seconds INTEGER NOT NULL DEFAULT 60,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_changed_at TEXT,
    updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  `);

  if (!columnExists("user_security_settings", "pin_enabled")) {
    db.exec("ALTER TABLE user_security_settings ADD COLUMN pin_enabled INTEGER NOT NULL DEFAULT 0;");
  }

  if (!columnExists("user_security_settings", "pin_hash")) {
    db.exec("ALTER TABLE user_security_settings ADD COLUMN pin_hash TEXT;");
  }

  if (!columnExists("user_security_settings", "pin_salt")) {
    db.exec("ALTER TABLE user_security_settings ADD COLUMN pin_salt TEXT;");
  }

  if (!columnExists("user_security_settings", "pin_kdf")) {
    db.exec("ALTER TABLE user_security_settings ADD COLUMN pin_kdf TEXT NOT NULL DEFAULT 'scrypt-v1';");
  }

  if (!columnExists("user_security_settings", "pin_idle_seconds")) {
    db.exec("ALTER TABLE user_security_settings ADD COLUMN pin_idle_seconds INTEGER NOT NULL DEFAULT 60;");
  }

  if (!columnExists("user_security_settings", "failed_attempts")) {
    db.exec("ALTER TABLE user_security_settings ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;");
  }

  if (!columnExists("user_security_settings", "locked_until")) {
    db.exec("ALTER TABLE user_security_settings ADD COLUMN locked_until TEXT;");
  }

  if (!columnExists("user_security_settings", "last_changed_at")) {
    db.exec("ALTER TABLE user_security_settings ADD COLUMN last_changed_at TEXT;");
  }

  if (!columnExists("user_security_settings", "updated_at")) {
    db.exec("ALTER TABLE user_security_settings ADD COLUMN updated_at TEXT;");
  }

  // ===== PREFERÊNCIAS DE NOTIFICAÇÃO DO USUÁRIO =====
  db.exec(`
  CREATE TABLE IF NOT EXISTS user_notification_preferences (
    user_id INTEGER PRIMARY KEY,
    friendship_activity INTEGER NOT NULL DEFAULT 1,
    shared_debt_new INTEGER NOT NULL DEFAULT 1,
    shared_debt_updates INTEGER NOT NULL DEFAULT 1,
    shared_debt_payments INTEGER NOT NULL DEFAULT 1,
    monthly_pix_updates INTEGER NOT NULL DEFAULT 1,
    card_due_today INTEGER NOT NULL DEFAULT 1,
    finance_date_alerts INTEGER NOT NULL DEFAULT 1,
    due_date_alerts INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  `);

  if (!columnExists("user_notification_preferences", "friendship_activity")) {
    db.exec("ALTER TABLE user_notification_preferences ADD COLUMN friendship_activity INTEGER NOT NULL DEFAULT 1;");
  }

  if (!columnExists("user_notification_preferences", "shared_debt_new")) {
    db.exec("ALTER TABLE user_notification_preferences ADD COLUMN shared_debt_new INTEGER NOT NULL DEFAULT 1;");
  }

  if (!columnExists("user_notification_preferences", "shared_debt_updates")) {
    db.exec("ALTER TABLE user_notification_preferences ADD COLUMN shared_debt_updates INTEGER NOT NULL DEFAULT 1;");
  }

  if (!columnExists("user_notification_preferences", "shared_debt_payments")) {
    db.exec("ALTER TABLE user_notification_preferences ADD COLUMN shared_debt_payments INTEGER NOT NULL DEFAULT 1;");
  }

  if (!columnExists("user_notification_preferences", "monthly_pix_updates")) {
    db.exec("ALTER TABLE user_notification_preferences ADD COLUMN monthly_pix_updates INTEGER NOT NULL DEFAULT 1;");
  }

  if (!columnExists("user_notification_preferences", "card_due_today")) {
    db.exec("ALTER TABLE user_notification_preferences ADD COLUMN card_due_today INTEGER NOT NULL DEFAULT 1;");
  }

  if (!columnExists("user_notification_preferences", "finance_date_alerts")) {
    db.exec("ALTER TABLE user_notification_preferences ADD COLUMN finance_date_alerts INTEGER NOT NULL DEFAULT 1;");
  }

  if (!columnExists("user_notification_preferences", "due_date_alerts")) {
    db.exec("ALTER TABLE user_notification_preferences ADD COLUMN due_date_alerts INTEGER NOT NULL DEFAULT 1;");
    try {
      db.exec("UPDATE user_notification_preferences SET due_date_alerts = COALESCE(shared_debt_payments, 1);");
    } catch (error) {
      // tabela ainda pode estar vazia ou em transição; sem drama
    }
  }

  if (!columnExists("user_notification_preferences", "updated_at")) {
    db.exec("ALTER TABLE user_notification_preferences ADD COLUMN updated_at TEXT;");
  }

  // ===== PASSKEYS / DESBLOQUEIO PELO APARELHO =====
  db.exec(`
  CREATE TABLE IF NOT EXISTS user_passkeys (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    label TEXT,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    device_type TEXT,
    backed_up INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    aaguid TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT,
    last_used_origin TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  `);

  if (!columnExists("user_passkeys", "label")) {
    db.exec("ALTER TABLE user_passkeys ADD COLUMN label TEXT;");
  }

  if (!columnExists("user_passkeys", "public_key")) {
    db.exec("ALTER TABLE user_passkeys ADD COLUMN public_key TEXT NOT NULL DEFAULT '';");
  }

  if (!columnExists("user_passkeys", "counter")) {
    db.exec("ALTER TABLE user_passkeys ADD COLUMN counter INTEGER NOT NULL DEFAULT 0;");
  }

  if (!columnExists("user_passkeys", "device_type")) {
    db.exec("ALTER TABLE user_passkeys ADD COLUMN device_type TEXT;");
  }

  if (!columnExists("user_passkeys", "backed_up")) {
    db.exec("ALTER TABLE user_passkeys ADD COLUMN backed_up INTEGER NOT NULL DEFAULT 0;");
  }

  if (!columnExists("user_passkeys", "transports")) {
    db.exec("ALTER TABLE user_passkeys ADD COLUMN transports TEXT;");
  }

  if (!columnExists("user_passkeys", "aaguid")) {
    db.exec("ALTER TABLE user_passkeys ADD COLUMN aaguid TEXT;");
  }

  if (!columnExists("user_passkeys", "created_at")) {
    db.exec("ALTER TABLE user_passkeys ADD COLUMN created_at TEXT NOT NULL DEFAULT '';");
  }

  if (!columnExists("user_passkeys", "updated_at")) {
    db.exec("ALTER TABLE user_passkeys ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';");
  }

  if (!columnExists("user_passkeys", "last_used_at")) {
    db.exec("ALTER TABLE user_passkeys ADD COLUMN last_used_at TEXT;");
  }

  if (!columnExists("user_passkeys", "last_used_origin")) {
    db.exec("ALTER TABLE user_passkeys ADD COLUMN last_used_origin TEXT;");
  }

  // ===== TABELAS EXISTENTES COM user_id =====
  db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    due_day INTEGER,
    close_day INTEGER,
    holiday_scope TEXT,
    brand TEXT,
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
    email TEXT,
    pix_enabled INTEGER NOT NULL DEFAULT 0,
    pix_key_type TEXT,
    pix_key_value TEXT,
    pix_city TEXT,
    pix_state TEXT,
    pix_label TEXT,
    pix_updated_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    is_owner INTEGER DEFAULT 0,
    profile_kind TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    deleted_at TEXT,
    deleted_label TEXT,
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

  CREATE TABLE IF NOT EXISTS import_overwrite_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    transaction_id INTEGER NOT NULL,
    import_id INTEGER,
    card_id INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    original_filename TEXT,
    preview_item_id TEXT,
    before_snapshot_json TEXT NOT NULL,
    after_snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id),
    FOREIGN KEY (import_id) REFERENCES imports(id),
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
    purchase_category_id INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (import_id) REFERENCES imports(id),
    FOREIGN KEY (card_id) REFERENCES cards(id),
    FOREIGN KEY (purchase_category_id) REFERENCES purchase_categories(id)
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

  CREATE TABLE IF NOT EXISTS purchase_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'default',
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, normalized_name),
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
    amount_mode TEXT NOT NULL DEFAULT 'fixed',
    carry_key TEXT,
    day_of_month INTEGER,
    schedule_kind TEXT,
    is_paid INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT,
    created_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (category_id) REFERENCES finance_categories(id)
  );

  CREATE TABLE IF NOT EXISTS monthly_finance_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finance_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    item_date TEXT,
    item_source TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    is_paid INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (finance_id) REFERENCES monthly_finances(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_monthly_finance_items_finance_user ON monthly_finance_items(finance_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_monthly_finance_items_user_date ON monthly_finance_items(user_id, item_date);

  CREATE TABLE IF NOT EXISTS monthly_finance_carry_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    carry_key TEXT NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, carry_key, month, year),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_monthly_finance_carry_exceptions_user_period ON monthly_finance_carry_exceptions(user_id, year, month);

  CREATE TABLE IF NOT EXISTS monthly_finance_alert_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    source_kind TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    type TEXT NOT NULL,
    date_key TEXT NOT NULL,
    payload_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, source_kind, source_ref, type, date_key),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_monthly_finance_alert_logs_date_user ON monthly_finance_alert_logs(date_key, user_id, type);

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
    purchase_category_id INTEGER,
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
    FOREIGN KEY (card_id) REFERENCES cards(id),
    FOREIGN KEY (purchase_category_id) REFERENCES purchase_categories(id)
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


  CREATE TABLE IF NOT EXISTS shared_debt_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_user_id INTEGER NOT NULL,
    requester_person_id INTEGER,
    receiver_user_id INTEGER NOT NULL,
    batch_id INTEGER,
    source_transaction_id INTEGER,
    source_allocation_id INTEGER,
    source_due_month INTEGER,
    source_due_year INTEGER,
    card_id INTEGER,
    card_name_snapshot TEXT,
    description_snapshot TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    amount_paid_cents INTEGER NOT NULL DEFAULT 0,
    receiver_email_snapshot TEXT,
    receiver_name_snapshot TEXT,
    request_note TEXT,
    promised_payment_date TEXT,
    response_note TEXT,
    payment_marked_at TEXT,
    payment_note TEXT,
    settlement_mode TEXT NOT NULL DEFAULT 'manual',
    last_pix_payload TEXT,
    last_pix_txid TEXT,
    last_pix_generated_at TEXT,
    last_pix_amount_cents INTEGER NOT NULL DEFAULT 0,
    pix_version INTEGER NOT NULL DEFAULT 0,
    request_kind TEXT NOT NULL DEFAULT 'card',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    responded_at TEXT,
    resolved_at TEXT,
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (requester_person_id) REFERENCES people(id),
    FOREIGN KEY (receiver_user_id) REFERENCES users(id),
    FOREIGN KEY (batch_id) REFERENCES shared_debt_batches(id),
    FOREIGN KEY (source_transaction_id) REFERENCES transactions(id),
    FOREIGN KEY (source_allocation_id) REFERENCES allocations(id),
    FOREIGN KEY (card_id) REFERENCES cards(id)
  );

  CREATE TABLE IF NOT EXISTS shared_debt_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_user_id INTEGER NOT NULL,
    receiver_user_id INTEGER NOT NULL,
    origin_kind TEXT NOT NULL DEFAULT 'single',
    status_summary TEXT NOT NULL DEFAULT 'pending',
    first_responded_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (receiver_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS shared_debt_archives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    is_archived INTEGER NOT NULL DEFAULT 1,
    archived_at TEXT,
    restored_at TEXT,
    archived_from_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(request_id, user_id),
    FOREIGN KEY (request_id) REFERENCES shared_debt_requests(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS shared_debt_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    actor_user_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (request_id) REFERENCES shared_debt_requests(id),
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS private_debt_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    person_id INTEGER,
    linked_user_id_snapshot INTEGER,
    person_name_snapshot TEXT NOT NULL,
    person_email_snapshot TEXT,
    person_phone_snapshot TEXT,
    description_snapshot TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    request_note TEXT,
    promised_payment_date TEXT,
    settlement_note TEXT,
    payment_date TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    is_archived INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT,
    restored_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    settled_at TEXT,
    cancelled_at TEXT,
    FOREIGN KEY (owner_user_id) REFERENCES users(id),
    FOREIGN KEY (person_id) REFERENCES people(id),
    FOREIGN KEY (linked_user_id_snapshot) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS manual_debt_due_alert_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    scope TEXT NOT NULL,
    date_key TEXT NOT NULL,
    payload_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, scope, date_key),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS shared_debt_monthly_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_user_id INTEGER NOT NULL,
    receiver_user_id INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    request_kind TEXT NOT NULL DEFAULT 'card',
    status TEXT NOT NULL DEFAULT 'open',
    request_count INTEGER NOT NULL DEFAULT 0,
    total_accepted_cents INTEGER NOT NULL DEFAULT 0,
    reserved_cents INTEGER NOT NULL DEFAULT 0,
    confirmed_cents INTEGER NOT NULL DEFAULT 0,
    open_cents INTEGER NOT NULL DEFAULT 0,
    last_reported_at TEXT,
    last_confirmed_at TEXT,
    last_rejected_at TEXT,
    last_activity_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(requester_user_id, receiver_user_id, month, year, request_kind),
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (receiver_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS shared_debt_payment_intents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    settlement_id INTEGER NOT NULL,
    requester_user_id INTEGER NOT NULL,
    receiver_user_id INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    request_kind TEXT NOT NULL DEFAULT 'card',
    requested_by_user_id INTEGER,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'generated',
    pix_payload TEXT,
    pix_txid TEXT,
    payer_note TEXT,
    creditor_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    generated_at TEXT,
    reported_at TEXT,
    confirmed_at TEXT,
    rejected_at TEXT,
    cancelled_at TEXT,
    FOREIGN KEY (settlement_id) REFERENCES shared_debt_monthly_settlements(id),
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (receiver_user_id) REFERENCES users(id),
    FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
    UNIQUE(pix_txid)
  );

  CREATE TABLE IF NOT EXISTS shared_debt_payment_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    settlement_id INTEGER NOT NULL,
    intent_id INTEGER NOT NULL,
    request_id INTEGER NOT NULL,
    allocated_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(intent_id, request_id),
    FOREIGN KEY (settlement_id) REFERENCES shared_debt_monthly_settlements(id),
    FOREIGN KEY (intent_id) REFERENCES shared_debt_payment_intents(id),
    FOREIGN KEY (request_id) REFERENCES shared_debt_requests(id)
  );

  CREATE TABLE IF NOT EXISTS shared_debt_send_queues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_user_id INTEGER NOT NULL,
    receiver_user_id INTEGER NOT NULL,
    source_due_month INTEGER NOT NULL,
    source_due_year INTEGER NOT NULL,
    request_kind TEXT NOT NULL DEFAULT 'card',
    status TEXT NOT NULL DEFAULT 'draft',
    receiver_email_snapshot TEXT,
    receiver_name_snapshot TEXT,
    total_cents INTEGER NOT NULL DEFAULT 0,
    item_count INTEGER NOT NULL DEFAULT 0,
    last_item_at TEXT,
    sent_at TEXT,
    batch_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (receiver_user_id) REFERENCES users(id),
    FOREIGN KEY (batch_id) REFERENCES shared_debt_batches(id)
  );

  CREATE TABLE IF NOT EXISTS shared_debt_send_queue_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id INTEGER NOT NULL,
    requester_user_id INTEGER NOT NULL,
    receiver_user_id INTEGER NOT NULL,
    source_transaction_id INTEGER NOT NULL,
    source_allocation_id INTEGER,
    source_person_id INTEGER NOT NULL,
    source_due_month INTEGER NOT NULL,
    source_due_year INTEGER NOT NULL,
    source_txn_date_snapshot TEXT,
    card_id INTEGER,
    card_name_snapshot TEXT,
    description_snapshot TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    receiver_email_snapshot TEXT,
    receiver_name_snapshot TEXT,
    action_kind TEXT NOT NULL DEFAULT 'create',
    target_request_id INTEGER,
    baseline_status_snapshot TEXT,
    sent_request_id INTEGER,
    cancelled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(queue_id, source_transaction_id, source_person_id),
    FOREIGN KEY (queue_id) REFERENCES shared_debt_send_queues(id),
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (receiver_user_id) REFERENCES users(id),
    FOREIGN KEY (source_transaction_id) REFERENCES transactions(id),
    FOREIGN KEY (source_allocation_id) REFERENCES allocations(id),
    FOREIGN KEY (source_person_id) REFERENCES people(id),
    FOREIGN KEY (card_id) REFERENCES cards(id),
    FOREIGN KEY (target_request_id) REFERENCES shared_debt_requests(id),
    FOREIGN KEY (sent_request_id) REFERENCES shared_debt_requests(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    href TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    related_type TEXT,
    related_id INTEGER,
    created_at TEXT NOT NULL,
    read_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    subscription_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS scheduled_push_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    date_key TEXT NOT NULL,
    sequence_no INTEGER NOT NULL DEFAULT 1,
    payload_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, event_type, date_key, sequence_no),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS email_delivery_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    target_user_id INTEGER,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    provider_message_id TEXT,
    error_message TEXT,
    attempt_no INTEGER NOT NULL DEFAULT 1,
    payload_json TEXT,
    created_by_user_id INTEGER,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (target_user_id) REFERENCES users(id),
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_user_id INTEGER NOT NULL,
    target_user_id INTEGER NOT NULL,
    source_person_id INTEGER,
    requester_name_snapshot TEXT,
    requester_email_snapshot TEXT,
    target_name_snapshot TEXT,
    target_email_snapshot TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    responded_at TEXT,
    resolved_at TEXT,
    response_note TEXT,
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (target_user_id) REFERENCES users(id),
    FOREIGN KEY (source_person_id) REFERENCES people(id)
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_low_id INTEGER NOT NULL,
    user_high_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    ended_at TEXT,
    ended_by_user_id INTEGER,
    origin_request_id INTEGER,
    source TEXT NOT NULL DEFAULT 'friend_request',
    UNIQUE(user_low_id, user_high_id),
    FOREIGN KEY (user_low_id) REFERENCES users(id),
    FOREIGN KEY (user_high_id) REFERENCES users(id),
    FOREIGN KEY (ended_by_user_id) REFERENCES users(id),
    FOREIGN KEY (origin_request_id) REFERENCES friend_requests(id)
  );

  CREATE TABLE IF NOT EXISTS person_app_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    linked_user_id INTEGER NOT NULL,
    match_kind TEXT NOT NULL DEFAULT 'friendship',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner_user_id, person_id),
    FOREIGN KEY (owner_user_id) REFERENCES users(id),
    FOREIGN KEY (person_id) REFERENCES people(id),
    FOREIGN KEY (linked_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL,
    updated_by_user_id INTEGER,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  );
  `);

  db.exec(`
  CREATE TABLE IF NOT EXISTS backup_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_name TEXT NOT NULL,
    trigger_kind TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'success',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    local_primary_path TEXT,
    local_secondary_path TEXT,
    google_file_id TEXT,
    google_view_link TEXT,
    google_folder_id TEXT,
    manifest_json TEXT,
    message TEXT,
    created_by_user_id INTEGER,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS backup_restores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_name TEXT,
    uploaded_filename TEXT,
    status TEXT NOT NULL DEFAULT 'success',
    message TEXT,
    safety_backup_run_id INTEGER,
    restored_by_user_id INTEGER,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    FOREIGN KEY (safety_backup_run_id) REFERENCES backup_runs(id),
    FOREIGN KEY (restored_by_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS merchant_learning_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    normalized_pattern TEXT NOT NULL,
    merchant_label TEXT NOT NULL,
    search_term TEXT,
    source_sample TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, normalized_pattern),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_backup_runs_started_at ON backup_runs(started_at DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_backup_restores_started_at ON backup_restores(started_at DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_merchant_learning_feedback_user_status ON merchant_learning_feedback(user_id, status, updated_at DESC);`);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_push_logs_event_date ON scheduled_push_logs(event_type, date_key, user_id, sequence_no);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_email_delivery_events_target_kind ON email_delivery_events(target_user_id, kind, created_at DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_email_delivery_events_status_created ON email_delivery_events(status, created_at DESC);`);

  db.exec("UPDATE users SET status = CASE WHEN trim(COALESCE(status, '')) = '' THEN 'active' ELSE lower(trim(status)) END;");
  db.exec("UPDATE people SET status = CASE WHEN trim(COALESCE(status, '')) = '' THEN CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END ELSE lower(trim(status)) END;");
  db.exec("UPDATE users SET deleted_label = 'Acesso removido' WHERE COALESCE(status, 'active') = 'deleted' AND trim(COALESCE(deleted_label, '')) = '';");
  db.exec("UPDATE people SET deleted_label = 'Contato removido' WHERE COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) = 'deleted' AND trim(COALESCE(deleted_label, '')) = '';");

  if (!columnExists("people", "pix_state")) {
    db.exec("ALTER TABLE people ADD COLUMN pix_state TEXT;");
  }

  if (!columnExists("people", "profile_kind")) {
    db.exec("ALTER TABLE people ADD COLUMN profile_kind TEXT;");
  }

  if (!columnExists("people", "status")) {
    db.exec("ALTER TABLE people ADD COLUMN status TEXT NOT NULL DEFAULT 'active';");
  }

  if (!columnExists("people", "deleted_at")) {
    db.exec("ALTER TABLE people ADD COLUMN deleted_at TEXT;");
  }

  if (!columnExists("people", "deleted_label")) {
    db.exec("ALTER TABLE people ADD COLUMN deleted_label TEXT;");
  }

  if (!columnExists("cards", "active")) {
    db.exec("ALTER TABLE cards ADD COLUMN active INTEGER NOT NULL DEFAULT 1;");
  }

  if (!columnExists("cards", "close_day")) {
    db.exec("ALTER TABLE cards ADD COLUMN close_day INTEGER;");
  }

  if (!columnExists("cards", "brand")) {
    db.exec("ALTER TABLE cards ADD COLUMN brand TEXT;");
  }

  if (!columnExists("people", "phone")) {
    db.exec("ALTER TABLE people ADD COLUMN phone TEXT;");
  }

  if (!columnExists("people", "email")) {
    db.exec("ALTER TABLE people ADD COLUMN email TEXT;");
  }

  if (!columnExists("people", "pix_enabled")) {
    db.exec("ALTER TABLE people ADD COLUMN pix_enabled INTEGER NOT NULL DEFAULT 0;");
  }

  if (!columnExists("people", "pix_key_type")) {
    db.exec("ALTER TABLE people ADD COLUMN pix_key_type TEXT;");
  }

  if (!columnExists("people", "pix_key_value")) {
    db.exec("ALTER TABLE people ADD COLUMN pix_key_value TEXT;");
  }

  if (!columnExists("people", "pix_city")) {
    db.exec("ALTER TABLE people ADD COLUMN pix_city TEXT;");
  }

  if (!columnExists("people", "pix_label")) {
    db.exec("ALTER TABLE people ADD COLUMN pix_label TEXT;");
  }

  if (!columnExists("people", "pix_updated_at")) {
    db.exec("ALTER TABLE people ADD COLUMN pix_updated_at TEXT;");
  }

  if (!columnExists("transactions", "due_month")) {
    db.exec("ALTER TABLE transactions ADD COLUMN due_month INTEGER;");
  }

  if (!columnExists("transactions", "due_year")) {
    db.exec("ALTER TABLE transactions ADD COLUMN due_year INTEGER;");
  }

  if (!columnExists("transactions", "parent_txn_id")) {
    db.exec("ALTER TABLE transactions ADD COLUMN parent_txn_id INTEGER;");
  }

  if (!columnExists("transactions", "recurring_rule_id")) {
    db.exec("ALTER TABLE transactions ADD COLUMN recurring_rule_id INTEGER;");
  }

  if (!columnExists("transactions", "purchase_category_id")) {
    db.exec("ALTER TABLE transactions ADD COLUMN purchase_category_id INTEGER;");
  }

  if (!columnExists("recurring_rules", "purchase_category_id")) {
    db.exec("ALTER TABLE recurring_rules ADD COLUMN purchase_category_id INTEGER;");
  }

  if (!columnExists("shared_debt_requests", "source_person_id")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN source_person_id INTEGER;");
  }

  if (!columnExists("shared_debt_requests", "source_txn_date_snapshot")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN source_txn_date_snapshot TEXT;");
  }

  if (!columnExists("shared_debt_requests", "payment_marked_at")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN payment_marked_at TEXT;");
  }

  if (!columnExists("shared_debt_requests", "promised_payment_date")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN promised_payment_date TEXT;");
  }

  if (!columnExists("shared_debt_requests", "payment_note")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN payment_note TEXT;");
  }

  if (!columnExists("shared_debt_requests", "batch_id")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN batch_id INTEGER;");
  }

  if (!columnExists("shared_debt_requests", "request_kind")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN request_kind TEXT NOT NULL DEFAULT 'card';");
  }

  if (!columnExists("shared_debt_requests", "amount_paid_cents")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN amount_paid_cents INTEGER NOT NULL DEFAULT 0;");
  }

  if (!columnExists("shared_debt_requests", "settlement_mode")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN settlement_mode TEXT NOT NULL DEFAULT 'manual';");
  }

  if (!columnExists("shared_debt_requests", "last_pix_payload")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN last_pix_payload TEXT;");
  }

  if (!columnExists("shared_debt_requests", "last_pix_txid")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN last_pix_txid TEXT;");
  }

  if (!columnExists("shared_debt_requests", "last_pix_generated_at")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN last_pix_generated_at TEXT;");
  }

  if (!columnExists("shared_debt_requests", "last_pix_amount_cents")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN last_pix_amount_cents INTEGER NOT NULL DEFAULT 0;");
  }

  if (!columnExists("shared_debt_requests", "pix_version")) {
    db.exec("ALTER TABLE shared_debt_requests ADD COLUMN pix_version INTEGER NOT NULL DEFAULT 0;");
  }

  if (!columnExists("private_debt_reminders", "promised_payment_date")) {
    db.exec("ALTER TABLE private_debt_reminders ADD COLUMN promised_payment_date TEXT;");
  }

  if (!tableExists("manual_debt_due_alert_logs")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS manual_debt_due_alert_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        scope TEXT NOT NULL,
        date_key TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, scope, date_key),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
  }

  if (!columnExists("shared_debt_payment_intents", "creditor_note")) {
    db.exec("ALTER TABLE shared_debt_payment_intents ADD COLUMN creditor_note TEXT;");
  }

  if (!columnExists("shared_debt_batches", "status_summary")) {
    db.exec("ALTER TABLE shared_debt_batches ADD COLUMN status_summary TEXT NOT NULL DEFAULT 'pending';");
  }

  if (!columnExists("shared_debt_batches", "first_responded_at")) {
    db.exec("ALTER TABLE shared_debt_batches ADD COLUMN first_responded_at TEXT;");
  }

  if (!columnExists("shared_debt_batches", "resolved_at")) {
    db.exec("ALTER TABLE shared_debt_batches ADD COLUMN resolved_at TEXT;");
  }

  if (!columnExists("shared_debt_send_queue_items", "action_kind")) {
    db.exec("ALTER TABLE shared_debt_send_queue_items ADD COLUMN action_kind TEXT NOT NULL DEFAULT 'create';");
  }

  if (!columnExists("shared_debt_send_queue_items", "target_request_id")) {
    db.exec("ALTER TABLE shared_debt_send_queue_items ADD COLUMN target_request_id INTEGER;");
  }

  if (!columnExists("shared_debt_send_queue_items", "baseline_status_snapshot")) {
    db.exec("ALTER TABLE shared_debt_send_queue_items ADD COLUMN baseline_status_snapshot TEXT;");
  }

  db.exec(`
  UPDATE shared_debt_send_queue_items
  SET action_kind = COALESCE(NULLIF(trim(action_kind), ''), 'create')
  WHERE action_kind IS NULL OR trim(action_kind) = '';
  `);

  if (!columnExists("closed_months", "user_id")) {
    db.exec("ALTER TABLE closed_months ADD COLUMN user_id INTEGER;");
  }

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_closed_months_user_month_year ON closed_months(user_id, month, year);");


  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase() || null;
  }

  function normalizeName(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeProfileKind(value, isOwner = false) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'self') return 'self';
    if (normalized === 'contact') return 'contact';
    return isOwner ? 'self' : 'contact';
  }

  function buildUniqueSelfName(userId, preferredName) {
    const base = String(preferredName || '').trim() || 'Meu perfil';
    const candidates = [base, `${base} (perfil)`, `${base} AcerttaPay`, `${base} Minha conta`];

    for (const candidate of candidates) {
      const exists = db.prepare(`
        SELECT id
        FROM people
        WHERE user_id = ? AND lower(name) = lower(?)
        LIMIT 1
      `).get(userId, candidate);
      if (!exists) return candidate;
    }

    let suffix = 2;
    while (suffix < 1000) {
      const candidate = `${base} (${suffix})`;
      const exists = db.prepare(`
        SELECT id
        FROM people
        WHERE user_id = ? AND lower(name) = lower(?)
        LIMIT 1
      `).get(userId, candidate);
      if (!exists) return candidate;
      suffix += 1;
    }

    return `${base} (${Date.now()})`;
  }

  function personHasStrongContactSignals(userId, personId) {
    const usage = db.prepare(`
      SELECT
        EXISTS(SELECT 1 FROM person_app_links WHERE owner_user_id = ? AND person_id = ?) AS has_app_link,
        EXISTS(SELECT 1 FROM friend_requests WHERE requester_user_id = ? AND source_person_id = ?) AS has_friend_history
    `).get(userId, personId, userId, personId);

    return Number(usage?.has_app_link || 0) !== 0 || Number(usage?.has_friend_history || 0) !== 0;
  }

  function pickSelfCandidateForUser(user) {
    const rows = db.prepare(`
      SELECT id, name, email, COALESCE(active, 1) AS active, COALESCE(is_owner, 0) AS is_owner, profile_kind, COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) AS status
      FROM people
      WHERE user_id = ?
        AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      ORDER BY COALESCE(is_owner, 0) DESC, COALESCE(active, 1) DESC, id ASC
    `).all(user.id);

    const existingSelf = rows.find((row) => normalizeProfileKind(row.profile_kind, Number(row.is_owner || 0) !== 0) === 'self');
    if (existingSelf) return existingSelf.id;

    const userEmail = normalizeEmail(user.email);
    const ownerEmailMatch = rows.find((row) => Number(row.is_owner || 0) !== 0 && userEmail && normalizeEmail(row.email) === userEmail);
    if (ownerEmailMatch) return ownerEmailMatch.id;

    const userName = normalizeName(user.name || user.email || '');
    const safeOwnerByName = rows.find((row) => {
      if (Number(row.is_owner || 0) === 0) return false;
      if (personHasStrongContactSignals(user.id, row.id)) return false;
      return userName && normalizeName(row.name) === userName;
    });
    if (safeOwnerByName) return safeOwnerByName.id;

    const ownerRows = rows.filter((row) => Number(row.is_owner || 0) !== 0);
    if (ownerRows.length === 1 && !personHasStrongContactSignals(user.id, ownerRows[0].id)) {
      return ownerRows[0].id;
    }

    const now = new Date().toISOString();
    const name = buildUniqueSelfName(user.id, user.name || (user.email ? user.email.split('@')[0] : 'Meu perfil'));
    const result = db.prepare(`
      INSERT INTO people (user_id, name, phone, email, pix_enabled, pix_key_type, pix_key_value, pix_city, pix_state, pix_label, pix_updated_at, active, is_owner, profile_kind, created_at)
      VALUES (?, ?, NULL, ?, 0, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1, 'self', ?)
    `).run(user.id, name, userEmail, now);

    return Number(result.lastInsertRowid || 0) || null;
  }

  function reconcileSelfProfiles() {
    const users = db.prepare(`
      SELECT id, email, name
      FROM users
      WHERE COALESCE(status, 'active') <> 'deleted'
      ORDER BY id ASC
    `).all();

    const updateTargetStmt = db.prepare(`
      UPDATE people
      SET active = 1,
          is_owner = 1,
          profile_kind = 'self',
          email = CASE WHEN trim(COALESCE(email, '')) = '' AND ? IS NOT NULL THEN ? ELSE email END,
          name = CASE WHEN trim(COALESCE(name, '')) = '' THEN ? ELSE name END
      WHERE id = ? AND user_id = ?
    `);

    const downgradeStmt = db.prepare(`
      UPDATE people
      SET is_owner = 0,
          profile_kind = 'contact'
      WHERE user_id = ? AND id <> ?
    `);

    db.transaction(() => {
      users.forEach((user) => {
        const targetId = pickSelfCandidateForUser(user);
        if (!targetId) return;

        downgradeStmt.run(user.id, targetId);
        updateTargetStmt.run(normalizeEmail(user.email), normalizeEmail(user.email), String(user.name || '').trim() || (normalizeEmail(user.email) || 'Meu perfil'), targetId, user.id);
      });
    })();
  }

  reconcileSelfProfiles();

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_people_user_self_unique ON people(user_id) WHERE profile_kind = 'self';");

  // ===== ÍNDICES =====
  db.exec(`
  CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);
  CREATE INDEX IF NOT EXISTS idx_people_user ON people(user_id);
  CREATE INDEX IF NOT EXISTS idx_people_user_profile_kind ON people(user_id, profile_kind);
  CREATE INDEX IF NOT EXISTS idx_people_user_status_active ON people(user_id, status, active);
  CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
  CREATE INDEX IF NOT EXISTS idx_imports_user ON imports(user_id);
  CREATE INDEX IF NOT EXISTS idx_import_overwrite_events_user_period ON import_overwrite_events(user_id, year, month, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_import_overwrite_events_txn ON import_overwrite_events(transaction_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_purchase_categories_user_active ON purchase_categories(user_id, active, sort_order, name);
  CREATE INDEX IF NOT EXISTS idx_purchase_categories_user_kind ON purchase_categories(user_id, kind, active);
  CREATE INDEX IF NOT EXISTS idx_txn_user ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_txn_card ON transactions(card_id);
  CREATE INDEX IF NOT EXISTS idx_txn_import ON transactions(import_id);
  CREATE INDEX IF NOT EXISTS idx_txn_purchase_category ON transactions(user_id, purchase_category_id);
  CREATE INDEX IF NOT EXISTS idx_alloc_user ON allocations(user_id);
  CREATE INDEX IF NOT EXISTS idx_alloc_txn ON allocations(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_statements_user ON card_statements(user_id);
  CREATE INDEX IF NOT EXISTS idx_payments_user ON person_payments(user_id);
  CREATE INDEX IF NOT EXISTS idx_txn_recurring_rule ON transactions(recurring_rule_id);
  CREATE INDEX IF NOT EXISTS idx_recurring_rules_user_status ON recurring_rules(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_people_email ON people(user_id, email);
  CREATE INDEX IF NOT EXISTS idx_shared_debts_receiver_status ON shared_debt_requests(receiver_user_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_shared_debts_requester_status ON shared_debt_requests(requester_user_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_shared_debts_source_allocation ON shared_debt_requests(source_allocation_id);
  CREATE INDEX IF NOT EXISTS idx_shared_debts_source_person ON shared_debt_requests(requester_user_id, source_transaction_id, source_person_id);
  CREATE INDEX IF NOT EXISTS idx_shared_debts_receiver_promised ON shared_debt_requests(receiver_user_id, promised_payment_date, status, request_kind);
  CREATE INDEX IF NOT EXISTS idx_shared_debts_requester_promised ON shared_debt_requests(requester_user_id, promised_payment_date, status, request_kind);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_batches_receiver ON shared_debt_batches(receiver_user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_batches_requester ON shared_debt_batches(requester_user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_archives_user_archived ON shared_debt_archives(user_id, is_archived, updated_at);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_archives_request_user ON shared_debt_archives(request_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_events_request ON shared_debt_events(request_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_private_debt_reminders_owner_status ON private_debt_reminders(owner_user_id, status, is_archived, updated_at);
  CREATE INDEX IF NOT EXISTS idx_private_debt_reminders_owner_person ON private_debt_reminders(owner_user_id, person_id, status);
  CREATE INDEX IF NOT EXISTS idx_private_debt_reminders_owner_archived ON private_debt_reminders(owner_user_id, is_archived, updated_at);
  CREATE INDEX IF NOT EXISTS idx_private_debt_reminders_owner_promised ON private_debt_reminders(owner_user_id, promised_payment_date, status, is_archived);
  CREATE INDEX IF NOT EXISTS idx_manual_debt_due_alert_logs_date_scope ON manual_debt_due_alert_logs(date_key, scope, user_id);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_monthly_settlements_pair ON shared_debt_monthly_settlements(requester_user_id, receiver_user_id, year, month, request_kind);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_monthly_settlements_receiver ON shared_debt_monthly_settlements(receiver_user_id, year, month, request_kind);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_payment_intents_settlement_status ON shared_debt_payment_intents(settlement_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_payment_intents_pair ON shared_debt_payment_intents(requester_user_id, receiver_user_id, year, month, request_kind, status);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_payment_allocations_intent ON shared_debt_payment_allocations(intent_id, request_id);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_payment_allocations_request ON shared_debt_payment_allocations(request_id);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_send_queues_requester_status ON shared_debt_send_queues(requester_user_id, status, source_due_year DESC, source_due_month DESC, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_send_queues_receiver_period ON shared_debt_send_queues(receiver_user_id, source_due_year DESC, source_due_month DESC);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_send_queue_items_queue ON shared_debt_send_queue_items(queue_id, source_txn_date_snapshot, id);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_send_queue_items_txn_person ON shared_debt_send_queue_items(requester_user_id, source_transaction_id, source_person_id);
  CREATE INDEX IF NOT EXISTS idx_shared_debt_send_queue_items_target_request ON shared_debt_send_queue_items(target_request_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at);
  CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_updated ON user_notification_preferences(updated_at);
  CREATE INDEX IF NOT EXISTS idx_friend_requests_requester_status ON friend_requests(requester_user_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_friend_requests_target_status ON friend_requests(target_user_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_friend_requests_pair_status ON friend_requests(requester_user_id, target_user_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_friendships_pair_status ON friendships(user_low_id, user_high_id, status);
  CREATE INDEX IF NOT EXISTS idx_person_app_links_owner_person ON person_app_links(owner_user_id, person_id);
  CREATE INDEX IF NOT EXISTS idx_person_app_links_owner_linked ON person_app_links(owner_user_id, linked_user_id);
  CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_created ON user_passkeys(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_last_used ON user_passkeys(user_id, last_used_at DESC);
  `);

  ensureIndexWithAliases(
    "CREATE INDEX IF NOT EXISTS idx_recurring_exceptions_rule_month ON recurring_exceptions(user_id, rule_id, year, month);",
    ['idx_recurring_exceptions_rule_month', 'idx_recurring_exceptions_user_rule_month']
  );

  ensureIndexWithAliases(
    "CREATE INDEX IF NOT EXISTS idx_shared_debts_batch_id ON shared_debt_requests(batch_id);",
    ['idx_shared_debts_batch_id', 'idx_shared_debt_requests_batch_id']
  );

  if (!columnExists("monthly_finances", "amount_mode")) {
    db.exec("ALTER TABLE monthly_finances ADD COLUMN amount_mode TEXT NOT NULL DEFAULT 'fixed';");
  }

  if (!columnExists("monthly_finances", "carry_key")) {
    db.exec("ALTER TABLE monthly_finances ADD COLUMN carry_key TEXT;");
  }

  if (!columnExists("monthly_finances", "day_of_month")) {
    db.exec("ALTER TABLE monthly_finances ADD COLUMN day_of_month INTEGER;");
  }

  if (!columnExists("monthly_finances", "schedule_kind")) {
    db.exec("ALTER TABLE monthly_finances ADD COLUMN schedule_kind TEXT;");
  }

  if (!columnExists("monthly_finances", "is_paid")) {
    db.exec("ALTER TABLE monthly_finances ADD COLUMN is_paid INTEGER NOT NULL DEFAULT 0;");
  }

  if (!columnExists("monthly_finances", "paid_at")) {
    db.exec("ALTER TABLE monthly_finances ADD COLUMN paid_at TEXT;");
  }

  if (!columnExists("monthly_finance_items", "is_paid")) {
    db.exec("ALTER TABLE monthly_finance_items ADD COLUMN is_paid INTEGER NOT NULL DEFAULT 0;");
  }

  if (!columnExists("monthly_finance_items", "paid_at")) {
    db.exec("ALTER TABLE monthly_finance_items ADD COLUMN paid_at TEXT;");
  }

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_finances_user_period_carry_key ON monthly_finances(user_id, month, year, carry_key) WHERE carry_key IS NOT NULL;");
  db.exec(`
  CREATE TABLE IF NOT EXISTS monthly_finance_carry_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    carry_key TEXT NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, carry_key, month, year),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_finance_carry_exceptions_user_period ON monthly_finance_carry_exceptions(user_id, year, month);");

  const DEFAULT_PURCHASE_CATEGORIES = [
    'Mercado',
    'Açougue',
    'Padaria',
    'Restaurante',
    'Lanche / Café',
    'Farmácia',
    'Saúde',
    'Transporte',
    'Combustível',
    'Casa',
    'Assinaturas',
    'Educação',
    'Vestuário',
    'Trabalho',
    'Lazer',
    'Pets',
    'Presentes',
    'Serviços',
    'Viagem',
    'Outros'
  ];

  function normalizePurchaseCategoryName(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function ensurePurchaseCategoriesForUser(userId) {
    const safeUserId = Number(userId || 0);
    if (!safeUserId) return;

    const existing = new Set(db.prepare(`
      SELECT normalized_name
      FROM purchase_categories
      WHERE user_id = ?
    `).all(safeUserId).map((row) => normalizePurchaseCategoryName(row.normalized_name || '')));

    const insertCategory = db.prepare(`
      INSERT OR IGNORE INTO purchase_categories (user_id, name, normalized_name, kind, active, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, 'default', 1, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    DEFAULT_PURCHASE_CATEGORIES.forEach((categoryName, index) => {
      const normalized = normalizePurchaseCategoryName(categoryName);
      if (!normalized || existing.has(normalized)) return;
      insertCategory.run(safeUserId, categoryName, normalized, index + 1, now, now);
    });
  }

  const userRowsForPurchaseSeed = db.prepare(`
    SELECT id
    FROM users
    ORDER BY id ASC
  `).all();

  db.transaction(() => {
    userRowsForPurchaseSeed.forEach((user) => {
      ensurePurchaseCategoriesForUser(user.id);
    });
  })();

  console.log("✅ Migração Multi-Usuário concluída!");
  console.log("✅ Tabela de usuários criada");
  console.log("✅ user_id adicionado a todas as tabelas");

  ensureMessageTemplateTables(db);
  syncMessageCatalogWithDatabase(db);

  console.log("✅ Categorias de compra opcionais preparadas");
}

module.exports = runMigrations;
module.exports.runMigrations = runMigrations;

if (require.main === module) {
  try {
    runMigrations();
  } catch (error) {
    console.error('[organizapay:migrate] Falha crítica na trilha oficial de migração.', error);
    process.exitCode = 1;
  }
}
