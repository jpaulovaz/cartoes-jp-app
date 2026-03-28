# AcerttaPay

AcerttaPay é uma aplicação web/PWA para controle financeiro com foco em cartões, competência mensal, distribuição por pessoa e negociação de dívidas compartilhadas entre usuários autorizados.

O projeto foi pensado para uso real no dia a dia, com fluxo forte em mobile, preservação de histórico e o mínimo possível de trabalho manual em tarefas repetitivas.

## O que o sistema faz

- autenticação com Google para usuários previamente autorizados
- gestão de cartões com vencimento e fechamento
- importação de faturas CSV
- lançamento manual à vista, parcelado e recorrente
- distribuição de lançamentos por pessoa
- visão mensal com ações em lote
- resumo por pessoa e por cartão
- detalhamento financeiro mensal
- compartilhamento visual da fatura
- automação opcional de envio por WhatsApp para administradores
- fluxo de dívidas compartilhadas entre usuários do sistema
- notificações in-app e push web
- painel administrativo para controle de acesso
- instalação como aplicativo (PWA)

## Principais diferenciais

- foco em **competência mensal** e não apenas em cadastro bruto de gastos
- preservação do **histórico financeiro** como regra de negócio
- suporte real a **parcelas** e **lançamentos recorrentes**
- modelo híbrido de controle: o sistema automatiza, mas o usuário continua podendo ajustar
- experiência pensada para **celular**, sem abandonar o desktop

## Stack

- Node.js
- Express
- EJS
- SQLite (`better-sqlite3`)
- Passport + Google OAuth 2.0
- PWA com `manifest.json` e `service worker`
- Push Web com `web-push`
- PM2 via `ecosystem.config.js`

## Estrutura do projeto

```text
.
├── public/                 # CSS, JS do cliente, ícones, manifest, service worker
├── scripts/                # migração e seed
├── src/
│   ├── db.js               # conexão SQLite
│   ├── dueDate.js          # cálculo de vencimento útil
│   ├── importers/          # parsers de CSV
│   └── utils.js            # utilitários gerais
├── views/                  # páginas EJS
├── data/                   # banco SQLite local
├── server.js               # aplicação principal
├── .env.example            # variáveis de ambiente
├── ecosystem.config.js     # configuração PM2
└── generate-vapid.js       # geração de chaves VAPID para push
```

## Fluxo principal do produto

### 1. Acesso

O login é feito via Google OAuth, mas apenas para e-mails previamente autorizados na tabela `users`.

No primeiro login bem-sucedido, o sistema garante a criação da pessoa titular vinculada ao usuário.

### 2. Cartões

Cada usuário pode cadastrar seus cartões com:

- nome
- dia de vencimento
- dia de fechamento
- status ativo/inativo

Esses dados alimentam a sugestão automática de competência e o resumo mensal.

### 3. Lançamentos

Os lançamentos podem entrar por dois caminhos:

- importação CSV da fatura
- cadastro manual

No cadastro manual, o sistema suporta:

- compra à vista
- compra parcelada
- lançamento recorrente mensal

Em compras parceladas, as transações são distribuídas automaticamente pelas competências futuras e mantêm vínculo por `parent_txn_id`.

### 4. Distribuição por pessoa

Cada lançamento pode ser distribuído entre uma ou mais pessoas.

O app calcula automaticamente a divisão do valor e permite operar em dois níveis:

- apenas a parcela atual
- a parcela atual e as próximas

Esse comportamento aparece tanto na edição individual quanto em ações em lote na visão mensal.

### 5. Resumo e conferência

O sistema oferece três visões principais:

- `/geral`: visão por competências e cartões
- `/month/:year/:month`: gestão detalhada dos lançamentos de um mês
- `/summary/:year/:month`: fechamento consolidado por pessoa e cartão

Além disso, `/detalhamento/:year/:month` reúne contas extras, lembretes, calculadora e visão ampliada do saldo mensal.

### 6. Dívidas compartilhadas

Quando uma pessoa selecionada em uma distribuição tem e-mail vinculado a outro usuário real do sistema, o app pode abrir uma cobrança compartilhada automaticamente.

O fluxo atual contempla:

- criação automática da solicitação
- aceite ou recusa pelo destinatário
- aceite da rejeição ou contestação pelo remetente
- marcação de pagamento pelo destinatário
- confirmação de recebimento pelo remetente
- histórico completo por solicitação
- notificações in-app e push

Tudo isso fica centralizado em `/shared-debts`.

### 7. Compartilhamento

O resumo por pessoa pode ser compartilhado de duas formas:

- `/share`: compartilhamento nativo do aparelho ou download da imagem
- `/whatsapp`: envio automatizado via Evolution API, disponível apenas para administradores

## Rotas principais

### Navegação

- `/` → redireciona para a visão geral autenticada
- `/geral` → meses e cartões
- `/month/:year/:month` → lançamentos da competência
- `/summary/:year/:month` → fechamento consolidado
- `/detalhamento/:year/:month` → visão financeira detalhada do mês

### Cadastros

- `/people` → pessoas
- `/cards` → cartões
- `/import` → importação de CSV

### Compartilhamento e comunicação

- `/share/:year/:month/:personId` → resumo compartilhável
- `/whatsapp/:year/:month/:personId` → envio automatizado via WhatsApp (admin)
- `/shared-debts` → fluxo de dívidas compartilhadas

### Administração

- `/admin` → gestão de usuários autorizados

## Regras de negócio importantes

### Preservação de histórico

O projeto prioriza preservar lançamentos passados. Sempre que possível, a decisão é:

- desativar em vez de apagar
- bloquear exclusões que destruam histórico
- manter coerência entre transações, alocações e fechamento

### Fechamento de mês

Quando uma competência é fechada, o sistema bloqueia alterações em vários fluxos críticos daquela competência.

### Titular

Cada usuário deve ter uma pessoa marcada como titular. Esse titular é usado em partes centrais do detalhamento mensal e dos cálculos agregados.

## Banco de dados

O banco padrão é SQLite e fica em:

```text
/data/app.db
```

Principais entidades:

- `users`
- `cards`
- `people`
- `imports`
- `transactions`
- `allocations`
- `card_statements`
- `person_payments`
- `monthly_finances`
- `scratchpad`
- `closed_months`
- `recurring_rules`
- `recurring_exceptions`
- `shared_debt_requests`
- `shared_debt_events`
- `notifications`
- `push_subscriptions`

## Como rodar localmente

## Pré-requisitos

- Node.js
- npm
- conta Google OAuth configurada

## Instalação

```bash
npm install
cp .env.example .env
npm run migrate
npm start
```

A aplicação sobe por padrão em:

```text
http://localhost:3001
```

## Variáveis de ambiente

O arquivo `.env.example` já traz a base. As principais variáveis são:

```env
PORT=3001
SESSION_SECRET=uma_chave_longa_e_aleatoria

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback

EVOLUTION_API_URL=https://sua-instancia.com
EVOLUTION_API_KEY=sua-chave
EVOLUTION_INSTANCE_NAME=sua-instancia

VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:voce@dominio.com

INACTIVITY_TIMEOUT_MINUTES=0
```

### O que cada bloco faz

- `SESSION_SECRET` → protege a sessão do usuário
- `GOOGLE_*` → autenticação Google
- `EVOLUTION_*` → envio automatizado via WhatsApp para admins
- `VAPID_*` → push notifications web
- `INACTIVITY_TIMEOUT_MINUTES` → força novo login após inatividade

## Criando o primeiro administrador

Como o login depende de e-mail autorizado, você precisa ter pelo menos um usuário na tabela `users` antes do primeiro acesso.

Exemplo com `sqlite3`:

```bash
sqlite3 data/app.db
```

```sql
INSERT INTO users (email, name, role, created_at)
VALUES ('voce@seudominio.com', 'Seu Nome', 'admin', datetime('now'));
```

Depois disso, acesse o app com esse mesmo e-mail via Google OAuth.

## Scripts disponíveis

```bash
npm start      # inicia o servidor
npm run migrate
npm run seed
```

## Push notifications

O projeto já suporta push web, desde que as chaves VAPID estejam configuradas.

### Gerar chaves

Se necessário, use o script auxiliar:

```bash
node generate-vapid.js
```

Depois copie as chaves para o `.env`.

### Requisitos práticos

- VAPID configurado
- HTTPS em produção
- permissão de notificações concedida pelo usuário

## WhatsApp / compartilhamento

Existem dois caminhos diferentes:

### `/share`

Página voltada a compartilhamento pelo próprio aparelho:
- usa a Web Share API quando disponível
- faz fallback para download da imagem

### `/whatsapp`

Página de automação via Evolution API:
- disponível apenas para administradores
- envia imagem + mensagem pelo backend

## PWA

O app possui:

- `manifest.json`
- ícones para instalação
- `service worker`
- modo `standalone`

Isso permite instalação como aplicativo em dispositivos compatíveis.

## Deploy com PM2

O projeto já inclui um `ecosystem.config.js` simples.

Exemplo:

```bash
pm2 start ecosystem.config.js
```

## Observações de manutenção

- `server.js` concentra muita lógica de negócio; no longo prazo, vale modularizar.
- O sistema já é suficientemente rico para se beneficiar de testes automáticos.
- Em produção, vale reforçar hardening web: sessão, CSRF, headers de segurança e limites de upload.

## Roadmap natural do produto

Boas evoluções futuras para o AcerttaPay:

- agrupamento inteligente de cobranças compartilhadas
- busca e filtros nas telas principais
- backup/restauração
- regras automáticas por descrição/estabelecimento
- passkeys/biometria para reautenticação
- auditoria de ações
- orçamento vs realizado

## Licença

MIT
