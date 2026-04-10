# Smoke de pré-produção — 3.20.9 — Fase 5A

## Objetivo
Validar a extração de `shared-debts` para `Router -> Controller -> Service -> Repository` sem alterar comportamento, redirects, JSON, Pix ou histórico.

## Fluxos mínimos
1. Abrir `/shared-debts` autenticado e conferir listas ativas.
2. Abrir `/shared-debts/archive` e conferir listas arquivadas.
3. Arquivar e restaurar uma cobrança compartilhada simples.
4. Arquivar e restaurar um lembrete privado.
5. Arquivar em lote e restaurar em lote.
6. Enviar e descartar item de `draft-queues`.
7. Criar lembrete avulso manual (`/shared-debts/manual`) para amizade válida.
8. Criar lembrete privado manual.
9. Quitar lembrete privado.
10. Aceitar e recusar envio em lote (`/shared-debts/batches/:id/respond`).
11. Aceitar e recusar solicitação individual (`/shared-debts/:id/respond`).
12. Aceitar recusa e contestar recusa (`/shared-debts/:id/sender-action`).
13. Preparar Pix mensal (`GET /shared-debts/monthly-settlements/:id/prepare`).
14. Gerar Pix mensal (`POST /shared-debts/monthly-settlements/:id/pix`).
15. Reportar, confirmar e rejeitar pagamento mensal.
16. Abrir Pix de lembrete avulso (`GET /shared-debts/:id/pix`).
17. Marcar pagamento individual e confirmar recebimento individual.
18. Marcar pagamento em lote e confirmar recebimento em lote.

## Critérios de aceite
- Nenhuma URL mudou.
- Nenhum redirect esperado mudou.
- Mensagens flash continuam coerentes com o fluxo original.
- JSON de Pix e mensal settlement continua com o mesmo desenho externo.
- Histórico, notificações e batches continuam sendo atualizados.
- `server.runtime.js` não mantém mais handlers inline de `shared-debts`.
