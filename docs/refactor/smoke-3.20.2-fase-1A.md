# Smoke de pré-produção — 3.20.2 — Fase 1A

## Objetivo da fase
Transformar a migração em trilha oficial chamável, sem `require()` com side effect no boot do app.

## Pré-condições
- Backup recente do `app.db` e do `sessions.sqlite`.
- Ambiente com as dependências instaladas.
- Cópia do banco real para o cenário controlado de validação.

## Smoke mínimo obrigatório
1. Executar a trilha oficial em banco novo:
   - `npm run migrate`
   - confirmar saída sem erro.
2. Executar a trilha oficial uma segunda vez no mesmo banco:
   - `npm run migrate`
   - confirmar que a execução permanece estável.
3. Subir o app em runtime normal:
   - `node server.js`
   - confirmar que o boot aborta claramente se a migração falhar.
4. Validar fluxo inicial de autenticação:
   - banco novo: `/login` redireciona para `/setup`
   - após setup: `/login` carrega normalmente
5. Validar fluxo básico autenticado:
   - login
   - home/mês
   - `/shared-debts`
   - `/admin/messages`

## Verificações rápidas de não regressão
- Importar `server.js` em script isolado não deve criar banco nem rodar migração automaticamente.
- Importar `scripts/migrate.js` em script isolado não deve rodar migração automaticamente.
- `server.createApp()` deve montar o app com a trilha oficial já executada.

## Resultado esperado
- O runtime continua com o mesmo comportamento externo.
- A trilha oficial de migração passa a ser chamada conscientemente.
- O app deixa de depender de `require('./scripts/migrate.js')` com side effect.
