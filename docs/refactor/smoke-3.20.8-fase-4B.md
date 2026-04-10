# Smoke de pré-produção — 3.20.8 — Fase 4B

## Escopo desta fase
- Importação de faturas (`/import`, preview, confirm, cancel)
- Resumo e analytics do mês (`/summary/:year/:month`, `/analytics/:year/:month`)
- Ações de aprendizado de merchant e pagamentos do resumo

## Smoke mínimo
1. Abrir `/import` com usuário que pode importar.
2. Enviar CSV válido e confirmar que a prévia aparece com totais e conflitos.
3. Cancelar a prévia e validar que o formulário continua preenchido.
4. Reenviar CSV, confirmar a importação e validar redirect para `/month/:year/:month`.
5. Testar cenário com sobrescrita manual elegível e conferir mensagem final.
6. Abrir `/summary/:year/:month` e `/analytics/:year/:month`.
7. Confirmar, dispensar, pausar e retomar sugestão de merchant.
8. Salvar cartões pagos no resumo via submit normal.
9. Salvar cartões pagos via endpoint async e validar JSON `{ ok: true }`.
10. Salvar pagamentos de pessoas via submit normal e async.
11. Repetir os passos 8 a 10 em mês fechado e confirmar o mesmo bloqueio já existente.

## Regressão lateral importante
- `/cards`
- `/finances/details/:id`
- `/admin`
- `/admin/messages`
- `/notifications`
- `/login`, `/logout`, `/lock`

## Resultado esperado
- Mesmas URLs, redirects, mensagens de erro e payloads JSON dos fluxos movidos.
- `server.runtime.js` sem rotas inline de import e summary/analytics.
