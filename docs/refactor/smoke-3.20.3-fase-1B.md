# Smoke de pré-produção - 3.20.3 - Fase 1B

## Objetivo da fase
Remover do runtime (`server.runtime.js`) toda evolução permanente de esquema e consolidar a trilha oficial em `scripts/migrate.js`.

## Pré-condições
- Backup recente do `app.db` e do `sessions.sqlite`.
- Ambiente com dependências instaladas.
- Cópia controlada do banco real para validar a rerun da migração em base existente.

## Smoke mínimo obrigatório
1. Executar a trilha oficial em banco novo:
   - `npm run migrate`
   - confirmar saída sem erro.
2. Executar a trilha oficial uma segunda vez no mesmo banco:
   - `npm run migrate`
   - confirmar que a execução continua estável.
3. Executar a trilha oficial em uma cópia do banco existente com dados:
   - `npm run migrate`
   - confirmar que o boot permanece íntegro e os dados continuam acessíveis.
4. Subir o app em runtime normal:
   - `node server.js`
   - confirmar login, home/mês, `/shared-debts` e `/admin/messages`.
5. Validar estruturas cobertas na fase:
   - `users.profile_signature_text`
   - `users.profile_signature_vibe`
   - `users.profile_signature_updated_at`
   - `people.phone`
   - `transactions.due_month`
   - `transactions.due_year`
   - `transactions.parent_txn_id`
   - `closed_months.user_id`
   - tabelas `backup_runs`, `backup_restores`, `merchant_learning_feedback`

## Verificações rápidas de não regressão
- `server.runtime.js` não deve conter `ALTER TABLE`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` nem `CREATE UNIQUE INDEX IF NOT EXISTS`.
- O runtime continua subindo com o mesmo comportamento externo.
- A rerun da migração não deve criar índice duplicado quando já existir o alias legado de:
  - `shared_debt_requests(batch_id)`
  - `recurring_exceptions(user_id, rule_id, year, month)`

## Resultado esperado
- O runtime deixa de ser local oficial de schema evolution.
- A trilha oficial passa a cobrir também o DDL residual que ainda estava no runtime.
- Banco novo e banco existente sobem apenas pela trilha oficial, mantendo login, mês e admin íntegros.
