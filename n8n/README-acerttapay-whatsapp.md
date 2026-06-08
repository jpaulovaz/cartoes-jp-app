# AcerttaPay - Workflow N8N para compras via WhatsApp

Este workflow importa a conversa do WhatsApp pela Evolution API, usa IA para transformar a mensagem em JSON e chama a API protegida do AcerttaPay em `/api/automation/v1`.

## Variáveis necessárias no N8N

Configure estas variáveis no ambiente do N8N antes de ativar o workflow:

```env
ACERTTAPAY_URL=https://seu-acerttapay.com
ACERTTAPAY_AUTOMATION_API_TOKEN=token-configurado-no-acerttapay
EVOLUTION_API_URL=https://sua-evolution-api.com
EVOLUTION_API_KEY=api-key-da-evolution
EVOLUTION_INSTANCE_NAME=nome-da-instancia
OPENAI_API_KEY=chave-do-provedor-de-ia
OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_URL=https://api.openai.com/v1/chat/completions
```

`OPENAI_API_URL` é opcional se o provedor for compatível com Chat Completions. Caso use outro provedor, ajuste os nós `AI Parse New Purchase` e `AI Parse Context Reply`.

## Importação

1. No N8N, vá em `Workflows`.
2. Escolha `Import from file`.
3. Importe `acerttapay-whatsapp-purchases.workflow.json`.
4. Abra o nó `WA Incoming` e copie a Production URL.
5. Configure essa URL como webhook da Evolution API.
6. Ative o workflow apenas depois de testar com a Test URL.

## Fluxo principal

1. `WA Incoming` recebe o evento da Evolution API.
2. `Normalize Evolution Payload` extrai número, texto, ID da mensagem e instância.
3. `Resolve AcerttaPay User` chama:

```txt
POST /api/automation/v1/whatsapp/resolve
```

4. Se o número não estiver autorizado, o usuário recebe orientação para ativar o WhatsApp no app.
5. Se houver conversa pendente, a IA interpreta a resposta contextual e chama:

```txt
POST /api/automation/v1/conversations/reply
```

6. Se não houver conversa pendente, a IA interpreta uma nova compra e chama:

```txt
POST /api/automation/v1/purchases
```

7. O AcerttaPay devolve `whatsapp.text` e o N8N envia a resposta pela Evolution API.

## Regras de IA

A IA não decide dados sensíveis quando houver ambiguidade. Ela deve perguntar quando faltar valor, descrição, data interpretável, parcelamento claro ou recorrência clara.

Exemplo de saída para compra nova:

```json
{
  "intent": "create_purchase",
  "confidence": 0.92,
  "needs_clarification": false,
  "clarifying_question": null,
  "purchase": {
    "date": "2026-06-08",
    "description": "Casas Bahia",
    "amount_cents": 19990,
    "installments": 1,
    "is_recurring": false,
    "card_hint": null,
    "category_hint": null
  }
}
```

Exemplo de saída contextual:

```json
{
  "intent": "select_split_participants",
  "confidence": 0.94,
  "participants": [8, 12],
  "include_self": false,
  "mode": "equal",
  "shares": []
}
```

## Segurança operacional

- O AcerttaPay exige `Authorization: Bearer <token>`.
- A criação de compra usa `Idempotency-Key` com ID da mensagem do WhatsApp.
- O AcerttaPay resolve o usuário pelo telefone autorizado, nunca por `user_id` enviado pelo N8N.
- O AcerttaPay valida cartão, mês fechado, valor, participantes, divisão e duplicidade.
- A cobrança para amigos fica como rascunho na Central de Acertos no MVP.

## Testes mínimos

Teste estes cenários antes de ativar para mais usuários:

```txt
Número não autorizado -> recebe aviso para ativar no app.
Usuário com um cartão ativo -> cria compra direto.
Usuário com vários cartões ativos -> pergunta qual cartão usar.
Resposta de cartão -> cria compra.
Compra criada -> pergunta se deseja dividir.
Resposta "não" -> encerra a conversa.
Resposta "sim" -> mostra opções de participantes.
Resposta com nomes + partes iguais -> aplica divisão.
Resposta com valores definidos -> valida soma exata.
Mensagem repetida com mesmo ID -> não duplica compra.
```

## Rollback

1. No AcerttaPay, desligue `AUTOMATION_API_ENABLED`.
2. Desative o workflow no N8N.
3. Remova ou pause o webhook da Evolution API.

As tabelas novas podem permanecer no banco sem impactar o app principal.
