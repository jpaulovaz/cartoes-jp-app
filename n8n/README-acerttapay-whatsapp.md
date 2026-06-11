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
