# AcerttaPay 4.2 - QA e rollout das compras compartilhadas aceitas

Este checklist fecha a linha 4.2.x da funcionalidade de compras compartilhadas aceitas em modo somente leitura e cobre o refinamento UX 4.2.11, que integrou compras próprias e compartilhadas no mesmo fluxo visual.

## Regra de ouro

A compra aceita deve ser projetada no sistema do recebedor. Ela nao deve criar `transactions`, `cards` nem `card_statements` para quem recebeu a cobranca.

## Feature flag

A exibicao das projecoes pode ser controlada por:

```env
ENABLE_SHARED_PURCHASE_PROJECTIONS=1
```

Para rollback operacional rapido, usar:

```env
ENABLE_SHARED_PURCHASE_PROJECTIONS=0
```

Com a flag desligada, as telas voltam a ignorar as projecoes sem apagar dados, migracoes ou historico da Central de Acertos.

## Checklist tecnico antes do deploy

1. Rodar migracoes no ambiente alvo.
2. Rodar `npm test`.
3. Rodar `npm run verify:shared-projections`.
4. Confirmar que `ENABLE_SHARED_PURCHASE_PROJECTIONS=1` esta definido no ambiente.
5. Abrir `/shared-debts` e validar que a rota continua funcionando como Central de Acertos.
6. Abrir `/month`, `/geral`, `/summary`, `/detalhamento` e `/analytics` com um usuario que recebeu uma cobranca aceita, confirmando a integração visual sem cards redundantes.
7. Exportar CSV pela interface e conferir a linha com `Origem = Compra compartilhada recebida` e `Somente leitura = Sim`.
8. Enviar resumo mensal por e-mail em ambiente com SMTP configurado e conferir o bloco de compartilhadas e o CSV anexo.


## Checklist UX 4.2.11

- `/month` deve exibir compras próprias e compartilhadas na mesma lista de **Lançamentos do período**.
- Linhas compartilhadas precisam ter chip `Compartilhada`, `data-shared-request-id` e `data-readonly-row="1"`.
- Linhas compartilhadas não podem ter `data-txn-id`, não entram em seleção em lote e não abrem ações de editar, excluir, dividir, mover ou categorizar.
- `/summary` não deve exibir painel separado de compartilhadas; elas aparecem no quadro **Cartões do período** como linhas de consulta, agrupadas por amigo/cartão/vencimento.
- `/detalhamento` deve mostrar **Pontos de atenção** antes do bloco de compras recebidas de amigos.
- `/geral` deve usar apenas resumo compacto, sem preview grande nem KPIs repetidos de compartilhadas.
- Textos visíveis devem usar linguagem simples, como `Compartilhada`, `Recebida de amigos` e `Central de Acertos`; evitar termos internos como `projeção` e `modo somente leitura` na interface principal.

## Cenários obrigatórios de homologação

### Fluxo feliz

- Usuario A cria uma compra positiva.
- A divide parte da compra com B.
- A envia a cobranca.
- B aceita.
- B deve ver somente a propria parte em:
  - `/month`
  - `/geral`
  - `/summary`
  - `/detalhamento`
  - `/analytics`
  - CSV mensal
  - resumo mensal por e-mail

### Pendente

- A envia a cobranca.
- B ainda nao aceita.
- A despesa nao deve aparecer nas telas financeiras de B.
- Deve permanecer apenas na Central de Acertos.

### Recusada

- B recusa a cobranca.
- A despesa nao deve aparecer no mes financeiro de B.

### Quitada

- B informa pagamento.
- A confirma.
- A projecao deve permanecer no mes de B como quitada, com pago confirmado.

### Parcial ou aguardando confirmacao

- Se houver pagamento parcial confirmado, mostrar `Parcial` e `Ainda falta`.
- Se houver pagamento informado e ainda nao confirmado, mostrar `Aguardando confirmacao`, sem declarar quitado.

### Negativos

- Compras, creditos, estornos ou ajustes negativos nao devem gerar projecao para o recebedor.
- A regra `amount_cents > 0` deve permanecer no repository.

### Somente leitura

No perfil do recebedor, a linha projetada nao pode permitir:

- editar;
- excluir;
- dividir;
- mover;
- categorizar;
- selecionar em lote;
- fechar fatura;
- marcar pagamento fora da Central de Acertos.

## Rollback

1. Alterar `ENABLE_SHARED_PURCHASE_PROJECTIONS=0`.
2. Reiniciar a aplicacao.
3. Conferir que as telas financeiras deixam de exibir projecoes.
4. Manter os indices e arquivos aplicados: eles sao seguros e nao criam dados financeiros duplicados.

## Comandos recomendados por release

```bash
npm test
npm run verify:shared-projections
node --check server.runtime.js
node --check public/app.js
node --check public/sw.js
node --check src/services/sharedPurchaseProjection.service.js
node --check src/repositories/sharedPurchaseProjection.repository.js
node --check src/monthTransactionsCsv.js
node --check src/services/monthlyEmailSummary.service.js
node --check src/emailMonthlySummaryTemplates.js
```
