# Smoke de pré-produção - 3.20.11 - Fase 6

## Objetivo
Fechar a trilha de refatoração com backend respirando, views críticas mais legíveis e documentação mínima para manutenção sem memória oral.

## Comandos mínimos antes do smoke manual

```bash
npm run migrate
npm test
npm run verify:refactor
```

## Smoke consolidado obrigatório

### 1. Acesso e shell do app
- abrir `/login`
- concluir login
- abrir uma rota autenticada simples (`/month/<ano>/<mes>` ou `/cards`)
- validar logout

### 2. Segurança e ajustes
- abrir `/settings`
- editar nome/telefone/e-mail
- testar upload e remoção de foto
- validar alertas
- validar Pix
- testar PIN e passkeys em ambiente seguro

### 3. Rede social e compartilhamento
- abrir `/people`
- editar assinatura/status
- criar ou editar contato
- responder amizade
- abrir "Compras comigo"
- validar `/share/:year/:month/:personId`
- validar `/whatsapp/:year/:month/:personId`

### 4. Núcleo financeiro
- abrir `/cards`
- abrir `/month/:year/:month`
- abrir `/finances/details/:id` em um item válido
- abrir `/summary/:year/:month`
- abrir `/analytics/:year/:month`
- fazer preview de importação em `/import`
- confirmar e cancelar preview

### 5. Cobranças complexas
- abrir `/shared-debts`
- testar resposta de cobrança
- testar mark-paid / confirm-receipt
- testar Pix mensal e Pix avulso, se houver fixture segura

### 6. Central administrativa
- abrir `/admin`
- testar `/admin/messages`
- testar conexão/envio de e-mail de teste
- validar backup manual
- validar download do backup

## Sinais de regressão que encerram a validação
- include quebrado em qualquer view EJS
- rota renderizando view sem os dados esperados
- partial removendo botão, badge, modal ou script de uma tela tocada
- `npm run verify:refactor` falhando
- divergência entre URL/redirect atual e o comportamento pré-refatoração

## Fechamento da fase
A Fase 6 só é considerada aceita quando:
- `npm test` passar
- `npm run verify:refactor` passar
- o smoke acima for concluído sem regressão relevante
- README e docs refletirem o desenho atual do projeto
