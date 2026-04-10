# Smoke de pre-producao - 3.20.7 - Fase 4A

## Escopo desta fase
- cards
- finances auxiliares do detalhamento

## Validacoes minimas
- abrir /cards
- criar cartao
- editar cartao
- desativar e reativar cartao
- excluir cartao sem historico
- bloquear exclusao de cartao com historico
- abrir detalhamento do mes
- GET /finances/details/:id em item existente
- POST /finances/add-row para entrada e saida
- POST /finances/variable/:id com multiplos itens
- POST /finances/fixed/:id ajustando dia e frequencia
- POST /finances/payment-toggle/:id
- POST /finance-items/payment-toggle/:id
- POST /finances/update/:id em descricao e formula
- POST /finances/delete/:id
- POST /finances/notes/:year/:month
- POST /finances/toggle-close fechando e reabrindo mes

## Nao incluido nesta fase
- month
- txn
- analytics
- summary
- share
- whatsapp
- shared-debts
