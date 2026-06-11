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

---

## Fluxo 3.1 - Lembretes e Alertas

```txt
3.1 - ACERTTAPAY_LEMBRETES.json
```

Responsabilidades:

- receber comandos de lembrete pelo WhatsApp;
- interpretar criação, listagem, conclusão, cancelamento e adiamento;
- persistir lembretes no AcerttaPay;
- nunca depender somente da memória do N8N para agendamento;
- responder com mensagens curtas e amigáveis.

### Intents do fluxo 3.1

```txt
greeting
help
create_reminder
list_reminders
complete_reminder
cancel_reminder
snooze_reminder
out_of_scope
```

### Endpoints da Etapa 4

```txt
POST /api/automation/v1/reminders
POST /api/automation/v1/reminders/search
POST /api/automation/v1/reminders/due
POST /api/automation/v1/reminders/:id/complete
POST /api/automation/v1/reminders/:id/cancel
POST /api/automation/v1/reminders/:id/snooze
POST /api/automation/v1/reminders/:id/mark-sent
```

### Códigos de resposta de lembretes

```txt
REMINDER_CREATED
REMINDERS_LIST
REMINDER_COMPLETED
REMINDER_CANCELLED
REMINDER_SNOOZED
DUE_REMINDERS
REMINDER_MARKED_SENT
MISSING_REMINDER_TITLE
MISSING_REMINDER_DATE
REMINDER_DATE_IN_PAST
REMINDER_NOT_FOUND
NEEDS_REMINDER_SELECTION
```

### Regras da família 3.x

- Lembretes são persistidos em `automation_reminders`.
- O N8N pode interpretar datas relativas, mas o AcerttaPay valida a data recebida.
- Se o usuário informar apenas a data, o backend usa `AUTOMATION_REMINDER_DEFAULT_TIME`.
- Lembrete disparado por WhatsApp continua aberto até o usuário concluir, cancelar ou adiar.
- O workflow `3.2 - ACERTTAPAY_LEMBRETES_DISPAROS` é responsável pelo disparo agendado.
- O disparo via WhatsApp cria também uma notificação local simples no AcerttaPay.

---

## Fluxo 4.1 - Central de Acertos

```txt
4.1 - ACERTTAPAY_CENTRAL_DE_ACERTOS.json
```

Responsabilidades:

- consultar pendências da Central de Acertos;
- listar cobranças recebidas e enviadas;
- listar rascunhos da caixa de saída;
- preparar e confirmar envio de rascunhos;
- aceitar ou recusar cobranças recebidas;
- contestar recusas quando o usuário é o remetente;
- marcar pagamento como feito quando o usuário é devedor;
- confirmar recebimento quando o usuário é credor;
- preparar e gerar Pix mensal para acertos de cartão.

### Intents do fluxo 4.1

```txt
greeting
help
shared_debt_summary
list_incoming_debts
list_outgoing_debts
list_draft_queues
send_draft_queue
accept_debt
reject_debt
contest_debt
mark_as_paid
confirm_received
generate_pix
out_of_scope
```

### Endpoints da Etapa 5

```txt
POST /api/automation/v1/shared-debts/summary
POST /api/automation/v1/shared-debts/drafts
POST /api/automation/v1/shared-debts/requests
POST /api/automation/v1/shared-debts/drafts/:queueId/prepare-send
POST /api/automation/v1/shared-debts/drafts/:queueId/confirm-send
POST /api/automation/v1/shared-debts/requests/:id/respond
POST /api/automation/v1/shared-debts/requests/:id/mark-paid
POST /api/automation/v1/shared-debts/requests/:id/confirm-received
POST /api/automation/v1/shared-debts/settlements/:id/pix/prepare
POST /api/automation/v1/shared-debts/settlements/:id/pix/create
POST /api/automation/v1/shared-debts/conversations/reply
```

### Códigos de resposta da Central de Acertos

```txt
SHARED_DEBT_SUMMARY
SHARED_DEBT_REQUESTS
DRAFT_QUEUES
NEEDS_DRAFT_SEND_CONFIRMATION
DRAFT_QUEUE_SENT
NEEDS_SHARED_DEBT_CONFIRMATION
SHARED_DEBT_REQUEST_UPDATED
NEEDS_PAYMENT_MARK_CONFIRMATION
PAYMENT_MARKED
NEEDS_RECEIPT_CONFIRMATION
PAYMENT_RECEIVED_CONFIRMED
NEEDS_PIX_CONFIRMATION
PIX_CREATED
SHARED_DEBT_ACTION_CANCELLED
REQUEST_NOT_FOUND
DRAFT_QUEUE_NOT_FOUND
SETTLEMENT_NOT_FOUND
PIX_NOT_CONFIGURED
PIX_INVALID
IDEMPOTENCY_KEY_REQUIRED
```

### Regras da família 4.x

- A IA interpreta intenção e filtros, mas o AcerttaPay valida o lado correto da relação: quem deve, quem enviou e quem pode confirmar.
- Toda escrita exige confirmação explícita e `Idempotency-Key`.
- Rascunhos continuam em rascunho até o usuário responder `enviar`.
- Recusa e contestação exigem nota/motivo.
- Pagamento marcado pelo devedor não encerra sozinho: quem recebeu precisa confirmar.
- Pix mensal usa a chave Pix do perfil `self` de quem vai receber.
- Se a pessoa, rascunho ou acerto for ambíguo, o backend pede o ID em vez de adivinhar.

---

## Fluxo 5.1 - Finanças Mensais

```txt
5.1 - ACERTTAPAY_FINANCAS_MENSAIS.json
```

Responsabilidades:

- lançar entradas e saídas mensais fora do cartão;
- listar finanças mensais por período, tipo e status;
- marcar saídas como pagas ou abertas;
- preparar correções e exclusões com confirmação explícita;
- bloquear alterações em mês fechado;
- diferenciar compra de cartão de conta mensal.

### Intents do fluxo 5.1

```txt
greeting
help
create_monthly_finance
list_monthly_finances
mark_finance_paid
mark_finance_unpaid
update_monthly_finance
delete_monthly_finance
out_of_scope
```

### Endpoints da Etapa 6

```txt
POST /api/automation/v1/monthly-finances
POST /api/automation/v1/monthly-finances/search
POST /api/automation/v1/monthly-finances/:id/mark-paid
POST /api/automation/v1/monthly-finances/:id/mark-unpaid
POST /api/automation/v1/monthly-finances/:id/update
POST /api/automation/v1/monthly-finances/:id/delete
POST /api/automation/v1/monthly-finances/conversations/reply
```

### Códigos de resposta de finanças mensais

```txt
MONTHLY_FINANCE_CREATED
MONTHLY_FINANCES_LIST
MONTHLY_FINANCE_MARKED_PAID
MONTHLY_FINANCE_MARKED_UNPAID
MONTHLY_FINANCE_UPDATED
MONTHLY_FINANCE_DELETED
NEEDS_MONTHLY_FINANCE_CONFIRMATION
MONTHLY_FINANCE_ACTION_CANCELLED
MONTHLY_FINANCE_NOT_FOUND
NEEDS_FINANCE_CLARIFICATION
MONTH_CLOSED
MISSING_UPDATE_PATCH
MONTHLY_FINANCE_VALIDATION_ERROR
MONTHLY_FINANCE_INTERNAL_ERROR
```

### Regras da família 5.x

- Finanças mensais são lançamentos fora do cartão.
- Compras de cartão devem continuar no fluxo 1.x.
- Se o mês estiver fechado, qualquer escrita deve ser bloqueada.
- Criações fixas/recorrentes, edições e exclusões pedem confirmação.
- `Idempotency-Key` é obrigatório para escritas confirmadas ou diretas.
- O usuário pode referenciar itens por código, como `#3`, ou por nome, como `internet`.
- Quando houver mais de um item parecido, o backend deve pedir esclarecimento e listar opções.

---

## Fluxo 6.1 - Fechamento Assistido

```txt
6.1 - ACERTTAPAY_FECHAMENTO_ASSISTIDO.json
```

Responsabilidades:

- diagnosticar se um mês pode ser fechado;
- listar bloqueadores críticos e avisos;
- preparar fechamento com confirmação forte;
- preparar reabertura com confirmação forte;
- persistir estado sensível de confirmação no AcerttaPay;
- registrar mutações de fechamento/reabertura.

### Intents do fluxo 6.1

```txt
greeting
help
month_close_readiness
month_close_blockers
month_close_summary
prepare_month_close
prepare_month_reopen
out_of_scope
```

### Endpoints da Etapa 7

```txt
POST /api/automation/v1/month-close/readiness
POST /api/automation/v1/month-close/prepare-close
POST /api/automation/v1/month-close/confirm-close
POST /api/automation/v1/month-close/prepare-reopen
POST /api/automation/v1/month-close/confirm-reopen
POST /api/automation/v1/month-close/conversations/reply
```

### Códigos de resposta de fechamento mensal

```txt
MONTH_READY_TO_CLOSE
MONTH_CLOSE_HAS_BLOCKERS
MONTH_CLOSE_BLOCKED
MONTH_ALREADY_CLOSED
MONTH_CLOSED
NEEDS_MONTH_CLOSE_CONFIRMATION
MONTH_ALREADY_OPEN
MONTH_REOPENED
NEEDS_MONTH_REOPEN_CONFIRMATION
MONTH_CLOSE_ACTION_CANCELLED
STRONG_CONFIRMATION_REQUIRED
NO_PENDING_MONTH_CLOSE_CONVERSATION
```

### Bloqueadores críticos

```txt
cards_open
people_open
monthly_finances_open
shared_debt_drafts
shared_debts_pending
purchases_without_participants
```

### Avisos não bloqueantes

```txt
uncategorized_purchases
```

### Regras da família 6.x

- Diagnóstico é sempre read-only.
- A IA nunca deve afirmar que fechou ou reabriu o mês sem resposta do AcerttaPay.
- O primeiro pedido de fechamento apenas prepara a ação e retorna a frase de confirmação.
- Para fechar, o usuário deve responder exatamente `fechar mês`.
- Para reabrir, o usuário deve responder exatamente `reabrir mês`.
- Se algum bloqueador crítico surgir entre o preparo e a confirmação, o backend deve bloquear o fechamento.
- Reabertura é permitida, mas sempre com confirmação forte e registro de mutação.

---

## Fluxo 7.1 - Importação de Fatura PDF por WhatsApp

```txt
7.1 - ACERTTAPAY_IMPORTACAO_PDF_WHATSAPP.json
```

Responsabilidades:

- receber documento PDF enviado pela Evolution API;
- baixar a mídia via N8N;
- extrair metadados de legenda com IA Agent;
- enviar o PDF ao AcerttaPay em base64;
- criar job de importação em `statement_import_jobs`;
- guardar temporariamente o PDF quando faltarem cartão, mês ou ano;
- permitir completar dados pendentes por conversa;
- consultar status e cancelar jobs elegíveis;
- nunca confirmar/importar compras automaticamente.

### Intents do fluxo 7.1

```txt
import_pdf_statement
complete_pdf_import_details
cancel_pdf_import
list_pdf_imports
status_pdf_import
help
out_of_scope
```

### Endpoints da Etapa 8

```txt
POST /api/automation/v1/imports/pdf/jobs
POST /api/automation/v1/imports/pdf/jobs/list
POST /api/automation/v1/imports/pdf/jobs/:id/status
POST /api/automation/v1/imports/pdf/jobs/:id/cancel
POST /api/automation/v1/imports/pdf/conversations/reply
```

### Códigos de resposta PDF

```txt
PDF_IMPORT_JOB_CREATED
NEEDS_PDF_IMPORT_DETAILS
PDF_IMPORT_JOB_STATUS
PDF_IMPORT_JOBS_LISTED
PDF_IMPORT_JOB_CANCELLED
PDF_IMPORT_STAGING_CANCELLED
PDF_FILE_REQUIRED
INVALID_PDF_FILE
PDF_TOO_LARGE
PDF_IMPORT_DISABLED
PDF_IMPORT_PROVIDER_NOT_READY
PDF_IMPORT_JOB_NOT_FOUND
PDF_IMPORT_STAGING_EXPIRED
PDF_IMPORT_RUNNING
```

### Regras da família 7.x

- PDF é arquivo de risco médio/alto: sempre vira job e revisão.
- Nenhum lançamento entra no app sem confirmação posterior na tela de importação.
- A IA pode sugerir cartão/mês/ano, mas o backend valida tudo.
- Se faltarem dados, o arquivo fica em staging temporário controlado por `AUTOMATION_PDF_STAGING_TTL_MINUTES`.
- Arquivos maiores que `AUTOMATION_PDF_MAX_FILE_BYTES` são recusados.
- Jobs em processamento não são cancelados pelo WhatsApp para evitar estado intermediário inconsistente.

---

## Fluxo 8.1 - Categorias e Aprendizado

```txt
8.1 - ACERTTAPAY_CATEGORIAS_E_APRENDIZADO.json
```

Responsabilidades:

- listar categorias de compra disponíveis;
- listar compras sem categoria;
- aplicar categoria a uma compra recente ou indicada por código;
- criar regra permanente de estabelecimento com confirmação;
- registrar aprendizado também em `merchant_learning_feedback`;
- aplicar regra futura automaticamente em novas compras quando houver correspondência segura.

### Intents do fluxo 8.1

```txt
category_options
show_uncategorized_purchases
set_purchase_category
set_merchant_category_rule
help
out_of_scope
```

### Endpoints da Etapa 9 - Categorias

```txt
POST /api/automation/v1/categories/options
POST /api/automation/v1/categories/uncategorized
POST /api/automation/v1/categories/apply-to-purchase
POST /api/automation/v1/categories/create-merchant-rule
POST /api/automation/v1/categories/conversations/reply
```

### Códigos de resposta de categorias

```txt
CATEGORY_OPTIONS
UNCATEGORIZED_PURCHASES
PURCHASE_CATEGORY_APPLIED
NEEDS_CATEGORY_RULE_CONFIRMATION
MERCHANT_CATEGORY_RULE_CREATED
CATEGORY_RULE_CANCELLED
CATEGORY_NOT_FOUND
PURCHASE_NOT_FOUND
PURCHASE_AMBIGUOUS
MONTH_CLOSED
```

### Regras da família 8.1

- Categorizar uma compra é escrita leve, mas ainda exige `Idempotency-Key`.
- O backend valida se a compra pertence ao usuário e se a fatura não está fechada.
- Quando a compra for parcelada, a categoria é aplicada em todas as parcelas do escopo.
- Criar regra permanente de estabelecimento sempre pede confirmação.
- Regras permanentes entram em `automation_merchant_category_rules` e também alimentam `merchant_learning_feedback`.
- Compras futuras criadas pela automação usam a regra aprendida quando o estabelecimento bater com segurança.

---

## Fluxo 8.2 - Resumos Inteligentes

```txt
8.2 - ACERTTAPAY_RESUMOS_INTELIGENTES.json
```

Responsabilidades:

- entregar resumo inteligente mensal sob demanda;
- entregar resumo semanal sob demanda;
- destacar maiores categorias, estabelecimentos e cartões;
- informar compras sem categoria;
- ativar/desativar resumo automático por WhatsApp com opt-in;
- disparar resumos automáticos apenas para usuários que aceitaram.

### Intents do fluxo 8.2

```txt
monthly_intelligent_summary
weekly_summary
spending_insights
enable_auto_summary
disable_auto_summary
help
out_of_scope
```

### Endpoints da Etapa 9 - Resumos

```txt
POST /api/automation/v1/insights/monthly
POST /api/automation/v1/insights/weekly
POST /api/automation/v1/insights/send-summary
POST /api/automation/v1/insights/preferences
POST /api/automation/v1/insights/due-summaries
POST /api/automation/v1/insights/preferences/:id/mark-sent
```

### Códigos de resposta de resumos

```txt
MONTHLY_INTELLIGENT_SUMMARY
WEEKLY_INTELLIGENT_SUMMARY
SMART_SUMMARY_OPT_IN_SAVED
SMART_SUMMARY_OPT_OUT_SAVED
DUE_SMART_SUMMARIES
SMART_SUMMARY_MARKED_SENT
SMART_SUMMARIES_DISABLED
```

### Regras da família 8.2

- Resumos sob demanda são read-only.
- Resumos automáticos são enviados somente para usuário opt-in.
- O workflow agendado consulta preferências vencidas e marca envio para evitar repetição no mesmo período.
- WhatsApp não deve virar spam: o usuário pode desligar resumo semanal ou mensal por mensagem.
- O backend continua sendo a fonte dos números; a IA só escolhe a intenção e o período.

## Etapa 10 — Observabilidade, segurança e escala operacional

A família `9.x` centraliza a operação das automações. Ela não precisa de um workflow conversacional obrigatório no N8N; o controle fica no AcerttaPay em `/admin/automation`, com o registro lógico `9.1 - ACERTTAPAY_OPERACOES_AUTOMACAO` no catálogo interno.

### Dashboard admin

Nova área:

```txt
/admin/automation
```

Recursos disponíveis:

- visão geral de workflows ativos, em manutenção e desligados;
- logs pesquisáveis por workflow, usuário, telefone, operação, código e status;
- últimos erros de automação;
- conversas pendentes ainda abertas;
- preferências por usuário/família de workflow;
- modo manutenção por workflow;
- rate limit por workflow;
- rotação do Bearer token da automação;
- limpeza de logs por política de retenção.

### Registro dos workflows

Tabela:

```txt
automation_workflow_registry
```

Cada família tem seu próprio interruptor. Desligar `4.1`, por exemplo, bloqueia a Central de Acertos pelo WhatsApp sem derrubar `1.1` ou `2.1`.

### Preferências por usuário

Tabela:

```txt
automation_user_preferences
```

Permite desligar uma família para um usuário específico, mesmo que o workflow esteja ativo globalmente.

### Observabilidade

Tabelas:

```txt
automation_intent_logs
automation_error_events
```

Essas tabelas complementam `automation_request_logs` e `automation_mutation_events`.

- `automation_intent_logs`: trilha pesquisável para cada chamada da Automation API.
- `automation_error_events`: eventos de erro e bloqueio operacional.
- `automation_mutation_events`: permanece como trilha de alterações financeiras relevantes.

### HMAC real

Quando `AUTOMATION_HMAC_REQUIRED=1`, cada chamada do N8N precisa enviar:

```txt
X-AcerttaPay-Timestamp: <epoch em segundos ou milissegundos>
X-AcerttaPay-Signature: sha256=<hmac_sha256(timestamp + "." + raw_body)>
```

O segredo usado é `AUTOMATION_HMAC_SECRET`.

A janela máxima aceita é controlada por:

```txt
AUTOMATION_HMAC_MAX_SKEW_SECONDS=300
```

### Rate limit por workflow

Além dos limites já existentes por telefone e por chave, cada workflow passa a ter limite próprio no registro de workflows. Se o campo estiver vazio ou inválido, o fallback é:

```txt
AUTOMATION_DEFAULT_WORKFLOW_RATE_LIMIT_PER_MINUTE=120
```

### Retenção

Configurações novas:

```txt
AUTOMATION_LOG_RETENTION_DAYS=90
AUTOMATION_ERROR_RETENTION_DAYS=180
```

A limpeza pode ser acionada pelo dashboard admin. Eventos de mutação financeira não entram nessa limpeza automática leve.


## Correção arquitetural 4.13.1 — Fluxo Inicial 0.0

A Evolution API deve apontar somente para o webhook do workflow `0.0 - ACERTTAPAY_FLUXO_INICIAL`. Os workflows funcionais `1.1` a `8.2` passam a ser subfluxos acionados pelo orquestrador via `Execute Workflow` e `EntradaWhatsapp`.

Responsabilidades do `0.0`:

- normalizar payload da Evolution API;
- ignorar mensagens próprias, grupos e mídias não suportadas;
- resolver usuário autorizado uma única vez;
- consultar conversa pendente, preferências do usuário, registry e modo manutenção;
- priorizar conversa pendente antes de classificar intenção com IA;
- montar menu dinâmico conforme capacidades liberadas;
- chamar o subfluxo correto;
- enviar a resposta final ao WhatsApp;
- registrar logs de roteamento.

Variáveis N8N obrigatórias:

```txt
ACERTTAPAY_URL=https://seu-acerttapay.com
ACERTTAPAY_AUTOMATION_API_TOKEN=<mesmo valor de AUTOMATION_API_TOKEN>
EVOLUTION_INSTANCE_NAME=<instancia>
REDIS_URL=redis://redis:6379/0
ACERTTAPAY_N8N_MEMORY_TTL_SECONDS=86400
```

Ponto operacional: no AcerttaPay a chave se chama `AUTOMATION_API_TOKEN`; no N8N se chama `ACERTTAPAY_AUTOMATION_API_TOKEN`. Elas devem ter o mesmo valor.

Redis Chat Memory substitui as memórias locais `memoryBufferWindow`. Redis guarda somente contexto conversacional da IA; estados financeiros sensíveis continuam no AcerttaPay em `automation_conversation_states`.
