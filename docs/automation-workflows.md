# Governança dos Workflows de Automação do AcerttaPay

Este documento padroniza a expansão do concierge WhatsApp do AcerttaPay.

## Convenção de famílias

```txt
1.x = Compra Assistida
2.x = Consultas Financeiras
3.x = Lembretes e Alertas
4.x = Central de Acertos
5.x = Finanças Mensais
6.x = Fechamento Mensal
7.x = Importações por WhatsApp
8.x = Inteligência, Categorias e Resumos
9.x = Governança, observabilidade e hardening
```

O número do workflow não é a versão do app. A versão do app continua em `package.json`.

## Fluxo atual

```txt
1.1 - ACERTTAPAY_COMPRA_ASSISTIDA_CONCIERGE.json
```

Responsabilidades:

- receber mensagem da Evolution API;
- normalizar telefone, mensagem e id da mensagem;
- usar IA Agent com memória curta para conversa;
- interpretar compras de cartão;
- chamar a Automation API;
- formatar respostas amigáveis para WhatsApp;
- nunca executar regra financeira fora do AcerttaPay.

## Intents do fluxo 1.1

### Concierge

```txt
greeting
help
clarification
out_of_scope
create_purchase
```

### Respostas contextuais

```txt
select_card
confirm_card
decline_card
confirm_split
skip_split
select_split_participants
exact_split
clarification
```

## Regra de participantes

O usuário pode dividir uma compra com uma ou várias pessoas.

Exemplos:

```txt
Apenas eu
Eu, Ana e Bruno
Ana e Bruno
Eu 99,90, Ana 50, Bruno 50
```

Regras:

- `Apenas eu` salva a compra somente no perfil próprio do usuário.
- `Ana e Bruno` não inclui o usuário automaticamente.
- `Eu, Ana e Bruno` inclui o usuário no rateio.
- Contatos locais podem participar para controle interno.
- Somente amigos elegíveis geram rascunhos na Central de Acertos.
- Nenhum rascunho é enviado automaticamente pelo WhatsApp no MVP.

## Contrato recomendado de resposta da Automation API

```json
{
  "ok": true,
  "code": "SOME_RESULT_CODE",
  "data": {},
  "conversation": {},
  "whatsapp": {
    "text": "mensagem pronta para o usuário"
  }
}
```

## Códigos de resposta padronizados

### Autorização e operação

```txt
AUTOMATION_DISABLED
AUTOMATION_TOKEN_MISSING
UNAUTHORIZED
IP_NOT_ALLOWED
RATE_LIMITED
NOT_AUTHORIZED
NO_PENDING_CONVERSATION
UNKNOWN_CONVERSATION_STATE
```

### Compra

```txt
PURCHASE_CREATED
NEEDS_CARD_SELECTION
NEEDS_CARD_CONFIRMATION
NO_ACTIVE_CARD
MONTH_CLOSED
VALIDATION_ERROR
DUPLICATE_MESSAGE
```

### Divisão

```txt
SPLIT_OPTIONS
NEEDS_SPLIT_CONFIRMATION
NEEDS_SPLIT_PARTICIPANTS
NEEDS_SPLIT_MODE
NEEDS_EXACT_AMOUNTS
SPLIT_SKIPPED
SPLIT_APPLIED
INVALID_PARTICIPANT
MISSING_PARTICIPANTS
SPLIT_TOTAL_MISMATCH
EXACT_SPLIT_UNSUPPORTED_FOR_INSTALLMENTS
```

## Matriz de risco

| Tipo de ação | Exemplos | Risco | Exigência |
|---|---|---:|---|
| Consulta | resumo do mês, compras recentes | Baixo | usuário autorizado |
| Criação simples | nova compra | Médio | idempotência e validação backend |
| Edição | corrigir valor, cartão, data | Alto | confirmação explícita |
| Remoção | apagar compra | Alto | confirmação forte e janela de tempo |
| Ação social/financeira | enviar cobrança, marcar pago | Alto | confirmação forte, status válido e logs |
| Fechamento mensal | fechar mês | Muito alto | preferir confirmação no app ou dupla confirmação |
| Importação por arquivo | PDF de fatura | Médio/alto | job, revisão e confirmação |

## Princípios obrigatórios

1. A IA pode conversar e interpretar, mas não é fonte de verdade financeira.
2. O AcerttaPay valida permissões, cartão, pessoa, amizade, mês fechado, soma e duplicidade.
3. Toda escrita precisa ser idempotente ou confirmada.
4. Ações críticas devem deixar log técnico.
5. O N8N pode manter memória conversacional; estados financeiros sensíveis ficam no AcerttaPay.
6. Mensagens precisam ser curtas, claras e compatíveis com WhatsApp.

## Pendência avaliada para etapa futura

Divisão por valores definidos em compras parceladas com parcelas de centavos diferentes ainda deve continuar conservadora. A melhoria futura recomendada é permitir que o usuário informe o valor total de cada pessoa e o backend distribua proporcionalmente entre parcelas, preservando a soma exata.

---

## Fluxo 2.1 - Consultas Financeiras

```txt
2.1 - ACERTTAPAY_CONSULTAS_FINANCEIRAS.json
```

Responsabilidades:

- receber mensagens de consulta financeira por WhatsApp;
- normalizar payload da Evolution API;
- validar o número autorizado pelo AcerttaPay;
- usar IA Agent apenas para classificar intenção e extrair filtros;
- consultar endpoints read-only da Automation API;
- responder com mensagens curtas e claras no WhatsApp;
- não modificar dados financeiros.

### Intents do fluxo 2.1

```txt
greeting
help
month_summary
card_summary
recent_purchases
purchases_by_day
purchases_by_card
purchases_by_person
person_summary
who_owes_me
what_do_i_owe
debt_summary
out_of_scope
```

### Endpoints read-only da Etapa 2

```txt
POST /api/automation/v1/queries/month-summary
POST /api/automation/v1/queries/card-summary
POST /api/automation/v1/queries/recent-purchases
POST /api/automation/v1/queries/person-summary
POST /api/automation/v1/queries/debt-summary
```

### Códigos de resposta de consultas

```txt
MONTH_SUMMARY
CARD_SUMMARY
CARD_SUMMARY_LIST
RECENT_PURCHASES
PURCHASES_BY_DAY
PERSON_SUMMARY
PERSON_SUMMARY_LIST
DEBT_SUMMARY
CARD_NOT_FOUND
NEEDS_CARD_CLARIFICATION
PERSON_NOT_FOUND
NEEDS_PERSON_CLARIFICATION
QUERY_VALIDATION_ERROR
QUERY_INTERNAL_ERROR
```

### Regras da família 2.x

- Consultas não criam, editam, removem, pagam ou enviam cobranças.
- Quando o usuário não informar período, usar o mês atual em `America/Sao_Paulo`.
- Cartões e pessoas citadas por nome são resolvidos no backend.
- Em caso de ambiguidade, o backend pede esclarecimento.
- O N8N pode dar tom de concierge, mas não inventa dados financeiros.

---

## Fluxo 1.2 - Correções de Compra

```txt
1.2 - ACERTTAPAY_COMPRA_ASSISTIDA_CORRECOES.json
```

Responsabilidades:

- consultar compras recentes;
- preparar correção de valor, data, cartão, descrição ou quantidade de parcelas;
- preparar exclusão de compra recente;
- exigir confirmação antes de qualquer escrita;
- usar `Idempotency-Key` na confirmação;
- manter logs em `automation_request_logs` e trilha de mutação em `automation_mutation_events`.

### Intents do fluxo 1.2

```txt
greeting
help
show_last_purchase
edit_last_purchase_amount
edit_last_purchase_date
edit_last_purchase_card
edit_last_purchase_description
edit_last_purchase_installments
delete_last_purchase
set_participants_later
clarification
out_of_scope
```

### Endpoints da Etapa 3

```txt
POST /api/automation/v1/purchases/recent
POST /api/automation/v1/purchases/:id/prepare-edit
POST /api/automation/v1/purchases/:id/confirm-edit
POST /api/automation/v1/purchases/:id/prepare-delete
POST /api/automation/v1/purchases/:id/confirm-delete
POST /api/automation/v1/purchases/:id/participants/reopen
```

### Códigos de resposta de correção/exclusão

```txt
RECENT_PURCHASES
NO_RECENT_PURCHASE
NEEDS_PURCHASE_EDIT_CONFIRMATION
PURCHASE_EDITED
PURCHASE_EDIT_CANCELLED
NEEDS_PURCHASE_DELETE_CONFIRMATION
PURCHASE_DELETED
PURCHASE_DELETE_CANCELLED
MISSING_EDIT_PATCH
MUTATION_WINDOW_CLOSED
SHARED_DEBT_ALREADY_SENT
IDEMPOTENCY_KEY_REQUIRED
IDEMPOTENCY_IN_PROGRESS
```

### Regras de segurança da Etapa 3

- Correções e remoções só são aplicadas após confirmação explícita.
- A janela padrão para compra que não nasceu da automação é `AUTOMATION_PURCHASE_MUTATION_WINDOW_HOURS`.
- Compras criadas pela automação podem ser corrigidas mesmo fora da janela, desde que não violem mês fechado ou Central de Acertos.
- Mês fechado bloqueia qualquer alteração.
- Rascunhos da Central de Acertos podem ser atualizados/removidos.
- Cobranças já enviadas, pendentes, aceitas ou liquidadas bloqueiam a mutação pelo WhatsApp.
- Toda mutação grava snapshot antes/depois em `automation_mutation_events`.

---

## Fluxo 1.3 - Participantes Posteriores

```txt
1.3 - ACERTTAPAY_COMPRA_ASSISTIDA_PARTICIPANTES.json
```

Responsabilidades:

- reabrir a seleção de participantes da última compra ou de uma compra indicada;
- reaproveitar os estados de divisão do fluxo 1.1;
- permitir `Apenas eu`, múltiplos participantes, partes iguais e valores definidos;
- manter o backend como fonte de verdade da divisão.

### Intents do fluxo 1.3

```txt
greeting
help
show_last_purchase
set_participants_later
clarification
out_of_scope
```

### Regras

- O usuário precisa responder `Eu` quando quiser entrar no rateio.
- Contatos locais entram apenas no controle interno.
- Amigos elegíveis geram rascunho na Central de Acertos.
- Nada é enviado automaticamente.
