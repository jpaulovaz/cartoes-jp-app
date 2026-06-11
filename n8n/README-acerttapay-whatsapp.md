# AcerttaPay - Workflow N8N WhatsApp Compra Assistida

Identificador do fluxo: `1.1 - ACERTTAPAY_COMPRA_ASSISTIDA_CONCIERGE`

> O `1.1` identifica a família e a sequência do workflow no N8N. Ele **não** é a versão do aplicativo. A versão do app continua no `package.json`, seguindo versionamento semântico.

## Papel deste workflow

Este é o primeiro fluxo da família **1.x - Compra Assistida**. Ele recebe mensagens do WhatsApp pela Evolution API, usa IA Agent para conversar com o usuário, interpreta compras e chama a Automation API do AcerttaPay para registrar lançamentos com segurança.

No MVP, o concierge pode:

- responder saudações e pedidos de ajuda;
- registrar nova compra de cartão;
- pedir cartão quando houver mais de um cartão ativo;
- confirmar o cartão quando o usuário citar um nome de cartão na mensagem;
- perguntar se o usuário deseja definir participantes;
- dividir com uma ou várias pessoas;
- dividir em partes iguais ou por valores definidos;
- incluir contatos locais no controle interno;
- deixar rascunhos na Central de Acertos apenas para amigos elegíveis.

## Convenção de nomes

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

Exemplos:

```txt
1.1 - ACERTTAPAY_COMPRA_ASSISTIDA_CONCIERGE.json
1.2 - ACERTTAPAY_COMPRA_ASSISTIDA_CORRECOES.json
2.1 - ACERTTAPAY_CONSULTAS_FINANCEIRAS.json
```

## Estilo de resposta

O fluxo usa mensagens curtas, blocos visuais, negrito do WhatsApp e emojis como ícones. A IA pode dar charme na conversa, mas o AcerttaPay continua sendo a fonte de verdade financeira.

Exemplo de saudação:

```txt
Oi! Eu sou o concierge do AcerttaPay. 🟢

Por aqui, neste piloto, eu já consigo:
• *registrar uma nova compra no cartão*
  Ex.: "Nova compra hoje de R$ 199,90 em Casas Bahia"

Me manda a compra do jeito que você fala mesmo. Se faltar algo, eu pergunto antes de lançar. ✅
```

Exemplo de compra registrada:

```txt
✅ *Compra registrada com sucesso!*

🧾 *Resumo da compra*
━━━━━━━━━━━━━━━━
🏬 Descrição: *Casas Bahia*
💰 Valor: *R$ 199,90*
💳 Cartão: *Nubank*
🗓️ Fatura: *06/2026*

Quer definir os participantes dessa compra?
Responde *sim* para dividir ou *não* para deixar só com você.
```

## Regra de participantes

A mensagem de divisão deve deixar claro que:

- `Apenas eu` deixa a compra só com o usuário;
- `Ana e Bruno` divide somente entre Ana e Bruno;
- `Eu, Ana e Bruno` inclui o usuário no rateio;
- contatos locais entram apenas no controle interno;
- amigos com Acerto disponível podem gerar rascunhos na Central de Acertos;
- nada é enviado automaticamente.

## Credenciais necessárias

Depois de importar o workflow, confira:

1. Credenciais do nó `Evolution API` em todos os nós de envio.
2. Credenciais do Gemini nos nós:
   - `Gemini Chat Model - Concierge`
   - `Gemini Chat Model - Context Reply`
3. Variáveis de ambiente do N8N:
   - `ACERTTAPAY_URL`
   - `ACERTTAPAY_AUTOMATION_API_TOKEN`
   - `EVOLUTION_INSTANCE_NAME`

O fluxo usa fallback local para `http://127.0.0.1:3000` se `ACERTTAPAY_URL` não estiver definido, mas em pre-prod/prod o correto é usar variável de ambiente.

## Testes de conversa sugeridos

```txt
Oi
```

Resposta esperada: apresentação do concierge e exemplo de compra.

```txt
Nova compra hoje de R$ 199,90 em Casas Bahia
```

Resposta esperada: cria compra ou pergunta cartão, conforme quantidade de cartões ativos.

```txt
Nova compra hoje de R$ 199,90 em Casas Bahia no Nubank
```

Resposta esperada: se o cartão Nubank existir e não houver ambiguidade, pergunta confirmação do cartão antes de lançar.

```txt
sim
```

Resposta esperada: confirma a etapa pendente, cria a compra no cartão confirmado ou avança para participantes.

```txt
Eu, Ana e Bruno
```

Resposta esperada: inclui o próprio usuário, Ana e Bruno no rateio.

```txt
Ana e Bruno
```

Resposta esperada: divide somente entre Ana e Bruno.

```txt
Eu 99,90, Ana 50, Bruno 50
```

Resposta esperada: aplica divisão por valores definidos somente se a soma fechar exatamente.

## Memória

O workflow usa `Window Buffer Memory` com session key por telefone:

```txt
acerttapay-wa:<telefone>
```

A memória serve apenas para contexto conversacional. Estado financeiro sensível, confirmação de cartão, confirmação de divisão e idempotência ficam no AcerttaPay.

---

# AcerttaPay - Workflow N8N WhatsApp Consultas Financeiras

Identificador do fluxo: `2.1 - ACERTTAPAY_CONSULTAS_FINANCEIRAS`

Este é o primeiro fluxo da família **2.x - Consultas Financeiras**. Ele usa IA Agent para entender perguntas do usuário e chama endpoints read-only da Automation API do AcerttaPay.

## O que o fluxo 2.1 consulta

```txt
Quanto gastei esse mês?
Quanto está a fatura do Nubank?
Quais compras fiz hoje?
Últimas compras do Itaú
Quanto a Ana tem comigo?
Quem me deve?
O que eu devo?
```

## Webhook de teste do fluxo 2.1

```txt
acerttapay-wa-queries
```

O workflow também possui `EntradaWhatsapp`, permitindo que um fluxo orquestrador principal chame esta família por `Execute Workflow` no futuro.

## Endpoints usados

```txt
POST /api/automation/v1/queries/month-summary
POST /api/automation/v1/queries/card-summary
POST /api/automation/v1/queries/recent-purchases
POST /api/automation/v1/queries/person-summary
POST /api/automation/v1/queries/debt-summary
```

## Memória

O workflow usa memória curta própria:

```txt
acerttapay-wa-queries:<telefone>
```

Essa memória serve apenas para contexto conversacional. As consultas continuam sempre buscando dados reais no AcerttaPay.

---

# AcerttaPay - Workflows N8N WhatsApp Correções e Participantes

## Fluxo 1.2 - Correções de compra

Identificador do fluxo:

```txt
1.2 - ACERTTAPAY_COMPRA_ASSISTIDA_CORRECOES
```

Este workflow pertence à família **1.x - Compra Assistida** e permite mostrar, corrigir ou apagar compras recentes com confirmação explícita no AcerttaPay.

Exemplos:

```txt
Mostra a última compra
Corrige a última compra para R$ 189,90
Troca o cartão da última compra para Nubank
Essa compra foi ontem
Era em 3x
Apaga a última compra
```

Webhook de teste:

```txt
acerttapay-wa-purchase-corrections
```

Endpoints usados:

```txt
POST /api/automation/v1/purchases/recent
POST /api/automation/v1/purchases/:id/prepare-edit
POST /api/automation/v1/purchases/:id/confirm-edit
POST /api/automation/v1/purchases/:id/prepare-delete
POST /api/automation/v1/purchases/:id/confirm-delete
POST /api/automation/v1/conversations/reply
```

Regras importantes:

- edição e exclusão sempre exigem confirmação;
- o N8N apenas interpreta a intenção;
- o AcerttaPay valida mês fechado, janela de segurança, rascunhos e cobranças já enviadas;
- exclusões/correções usam `Idempotency-Key` na confirmação;
- compras com cobranças já enviadas/aceitas na Central de Acertos são bloqueadas pelo backend.

## Fluxo 1.3 - Participantes posteriores

Identificador do fluxo:

```txt
1.3 - ACERTTAPAY_COMPRA_ASSISTIDA_PARTICIPANTES
```

Este workflow reabre a definição de participantes de uma compra recente quando o usuário não definiu a divisão no momento do cadastro.

Exemplos:

```txt
Quero dividir a última compra
Definir participantes da última compra
Colocar Ana e Bruno na última compra
```

Webhook de teste:

```txt
acerttapay-wa-purchase-participants
```

Endpoints usados:

```txt
POST /api/automation/v1/purchases/recent
POST /api/automation/v1/purchases/:id/participants/reopen
POST /api/automation/v1/conversations/reply
```

Memória dos novos fluxos:

```txt
acerttapay-wa-corrections:<telefone>
acerttapay-wa-participants:<telefone>
```

A memória é apenas conversacional. Estados de confirmação, divisão e mutação ficam no AcerttaPay.

---

# AcerttaPay - Workflows N8N WhatsApp Lembretes e Alertas

## Fluxo 3.1 - Lembretes

Identificador do fluxo:

```txt
3.1 - ACERTTAPAY_LEMBRETES
```

Este workflow pertence à família **3.x - Lembretes e Alertas**. Ele permite criar, listar, concluir, cancelar e adiar lembretes financeiros pelo WhatsApp.

Exemplos:

```txt
Me lembra amanhã de pagar a fatura do Nubank
Me lembra dia 15 às 10h de cobrar o Bruno
Quais lembretes tenho essa semana?
Concluir lembrete #3
Cancelar lembrete #4
Adiar lembrete #5 por 1 hora
```

Webhook de teste:

```txt
acerttapay-wa-reminders
```

Endpoints usados:

```txt
POST /api/automation/v1/reminders
POST /api/automation/v1/reminders/search
POST /api/automation/v1/reminders/:id/complete
POST /api/automation/v1/reminders/:id/cancel
POST /api/automation/v1/reminders/:id/snooze
```

Memória do fluxo:

```txt
acerttapay-wa-reminders:<telefone>
```

A memória é apenas conversacional. Os lembretes ficam persistidos no AcerttaPay na tabela `automation_reminders`.

## Fluxo 3.2 - Disparos de lembretes

Identificador do fluxo:

```txt
3.2 - ACERTTAPAY_LEMBRETES_DISPAROS
```

Este workflow é agendado e consulta periodicamente o AcerttaPay para encontrar lembretes vencidos que ainda não foram enviados por WhatsApp.

Endpoints usados:

```txt
POST /api/automation/v1/reminders/due
POST /api/automation/v1/reminders/:id/mark-sent
```

Fluxo operacional:

```txt
Schedule Trigger
↓
Buscar lembretes vencidos no AcerttaPay
↓
Enviar WhatsApp pela Evolution API
↓
Marcar lembrete como enviado no AcerttaPay
```

Variáveis úteis:

```txt
ACERTTAPAY_URL
ACERTTAPAY_AUTOMATION_API_TOKEN
EVOLUTION_INSTANCE_NAME
AUTOMATION_REMINDER_DUE_BATCH_LIMIT
```

O lembrete não é concluído automaticamente após o disparo. O usuário pode responder pelo fluxo `3.1` com:

```txt
Concluir lembrete #3
Adiar lembrete #3 por 1 hora
Cancelar lembrete #3
```

---

# AcerttaPay - Workflow N8N WhatsApp Central de Acertos

## Fluxo 4.1 - Central de Acertos

Identificador do fluxo:

```txt
4.1 - ACERTTAPAY_CENTRAL_DE_ACERTOS
```

Este workflow pertence à família **4.x - Central de Acertos**. Ele permite consultar pendências, listar rascunhos, preparar envio de rascunhos, aceitar/recusar acertos, contestar recusas, marcar pagamento, confirmar recebimento e preparar Pix mensal pelo WhatsApp.

Exemplos:

```txt
Quem me deve esse mês?
O que eu devo para Ana?
Listar rascunhos
Enviar rascunho #12
Aceitar cobrança #8
Recusar #8 porque já paguei por fora
Marcar acerto #8 como pago
Confirmar recebimento #8
Gerar Pix do acerto com Bruno
```

Webhook de teste:

```txt
acerttapay-wa-shared-debts
```

Endpoints usados:

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

Memória do fluxo:

```txt
acerttapay-wa-shared-debts:<telefone>
```

A memória é apenas conversacional. Confirmações sensíveis ficam persistidas no AcerttaPay como estado de conversa.

Regras importantes:

- Enviar rascunho exige confirmação explícita.
- Aceitar, recusar, contestar, marcar pagamento e confirmar recebimento exigem confirmação explícita.
- Recusa e contestação precisam de nota/motivo.
- Pix mensal só é gerado quando há carteira mensal aberta e Pix válido no perfil de quem vai receber.
- Nenhuma cobrança é enviada automaticamente sem confirmação do usuário.

---

# AcerttaPay - Workflow N8N WhatsApp Finanças Mensais

Identificador do fluxo: `5.1 - ACERTTAPAY_FINANCAS_MENSAIS`

Este é o primeiro fluxo da família **5.x - Finanças Mensais**. Ele cuida de entradas e saídas fora do cartão, como aluguel, salário, internet, conta de luz, recebimentos e despesas mensais que o usuário controla no detalhamento do mês.

## O que o fluxo 5.1 faz

```txt
Lançar aluguel de R$ 2.500 para junho
Adicionar salário de R$ 5.000 este mês
Conta de luz R$ 180 vencendo dia 12
Quais contas tenho esse mês?
Marcar internet como paga
Voltar internet para aberta
Corrigir aluguel para R$ 2.600
Apagar conta de luz
```

## Webhook de teste do fluxo 5.1

```txt
acerttapay-wa-monthly-finances
```

O workflow também possui `EntradaWhatsapp`, permitindo que um fluxo orquestrador principal chame esta família por `Execute Workflow` no futuro.

## Endpoints usados

```txt
POST /api/automation/v1/monthly-finances
POST /api/automation/v1/monthly-finances/search
POST /api/automation/v1/monthly-finances/:id/mark-paid
POST /api/automation/v1/monthly-finances/:id/mark-unpaid
POST /api/automation/v1/monthly-finances/:id/update
POST /api/automation/v1/monthly-finances/:id/delete
POST /api/automation/v1/monthly-finances/conversations/reply
```

## Regras importantes

- O N8N interpreta intenção e conversa; o AcerttaPay valida mês, valor, tipo, status e telefone autorizado.
- Lançamentos fixos, recorrentes ou sensíveis pedem confirmação antes de salvar.
- Edição e exclusão pedem confirmação explícita.
- Alterações usam `Idempotency-Key`.
- Se o mês estiver fechado, o backend bloqueia.
- Compra no cartão não entra neste fluxo; deve ir para `1.1 - ACERTTAPAY_COMPRA_ASSISTIDA_CONCIERGE`.

## Memória

O workflow usa memória curta própria:

```txt
acerttapay-wa-monthly-finances:<telefone>
```

A memória serve para contexto conversacional. Confirmações de escrita ficam persistidas no AcerttaPay em `automation_conversation_states`.

---

# AcerttaPay - Workflow N8N WhatsApp Fechamento Assistido

Identificador do fluxo: `6.1 - ACERTTAPAY_FECHAMENTO_ASSISTIDO`

Este é o primeiro fluxo da família **6.x - Fechamento Mensal**. Ele funciona como uma conferência guiada antes de fechar ou reabrir um mês no AcerttaPay.

## O que o fluxo 6.1 faz

```txt
Posso fechar junho?
O que falta para fechar esse mês?
Quais pendências bloqueiam o fechamento?
Fechar junho
Reabrir junho
```

## Webhook de teste do fluxo 6.1

```txt
acerttapay-wa-month-close
```

O workflow também possui `EntradaWhatsapp`, permitindo que um fluxo orquestrador principal chame esta família por `Execute Workflow` no futuro.

## Endpoints usados

```txt
POST /api/automation/v1/month-close/readiness
POST /api/automation/v1/month-close/prepare-close
POST /api/automation/v1/month-close/confirm-close
POST /api/automation/v1/month-close/prepare-reopen
POST /api/automation/v1/month-close/confirm-reopen
POST /api/automation/v1/month-close/conversations/reply
```

## Regras importantes

- Diagnóstico não altera dados.
- Fechamento só acontece se não houver bloqueadores críticos.
- Fechamento exige confirmação textual forte: `fechar mês`.
- Reabertura exige confirmação textual forte: `reabrir mês`.
- A IA conversa e classifica intenção; o AcerttaPay valida tudo e persiste o estado sensível.
- Alterações usam `Idempotency-Key`.
- Ao fechar ou reabrir, o AcerttaPay registra evento de mutação e notificação local.

## Bloqueadores críticos avaliados

```txt
Cartões com fatura em aberto
Pessoas com saldo em aberto
Cobranças em rascunho
Cobranças pendentes na Central de Acertos
Finanças mensais não pagas
Compras sem participantes
```

Compras sem categoria aparecem como aviso, mas não bloqueiam o fechamento.

## Memória

O workflow usa memória curta própria:

```txt
acerttapay-wa-month-close:<telefone>
```

A memória é apenas conversacional. Confirmação de fechamento/reabertura fica em `automation_conversation_states`.
