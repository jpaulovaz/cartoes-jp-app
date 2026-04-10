function createAuthRepository(deps = {}) {
  const {
    db,
    appSettingsUpsert,
    ensurePurchaseCategoriesForUser,
    markAppSetupCompleted
  } = deps;

  function completeInitialSetup({ safeAdminEmail, safeAdminName, nextSettings, now, defaultFinanceCategories = [] }) {
    return db.transaction(() => {
      Object.entries(nextSettings).forEach(([key, value]) => {
        appSettingsUpsert.run(key, String(value ?? ''), now, null);
      });

      const existingUser = db.prepare('SELECT id, email, name, role, can_import FROM users WHERE email = ?').get(safeAdminEmail);
      let adminId = null;

      if (existingUser) {
        db.prepare(`
          UPDATE users
             SET name = ?,
                 role = 'admin',
                 can_import = 1
           WHERE id = ?
        `).run(safeAdminName || existingUser.name || safeAdminEmail.split('@')[0], existingUser.id);
        adminId = existingUser.id;
      } else {
        const result = db.prepare(`
          INSERT INTO users (email, name, role, can_import, created_at, last_login)
          VALUES (?, ?, 'admin', 1, ?, NULL)
        `).run(safeAdminEmail, safeAdminName || safeAdminEmail.split('@')[0], now);
        adminId = Number(result.lastInsertRowid);
      }

      if (!adminId) {
        throw new Error('Não consegui preparar o admin inicial agora.');
      }

      const insertCat = db.prepare('INSERT OR IGNORE INTO finance_categories (user_id, name) VALUES (?, ?)');
      defaultFinanceCategories.forEach((category) => insertCat.run(adminId, category));
      ensurePurchaseCategoriesForUser(adminId);
      markAppSetupCompleted(true, adminId);

      return {
        adminId: Number(adminId || 0)
      };
    })();
  }

  return {
    completeInitialSetup
  };
}

module.exports = {
  createAuthRepository
};
