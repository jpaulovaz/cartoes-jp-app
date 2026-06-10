# AcerttaPay - Workflow N8N WhatsApp Compra Assistida

Versão do fluxo: `1.5 - ACERTTAPAY_COMPRA_ASSISTIDA_CONCIERGE`

## O que mudou nesta revisão

- O fluxo agora segue um tom mais próximo do modelo analisado nos vídeos: mensagens curtas, blocos bem separados, títulos em negrito, emojis como ícones e chamadas claras para a próxima ação.
- O agente `AI Concierge Router` deixou de ser apenas um parser de compra e passou a funcionar como concierge conversacional:
  - responde saudações como `Oi`, `Olá`, `bom dia`;
  - explica o que consegue fazer no MVP;
  - conversa para pedir dados faltantes;
  - usa memória curta por telefone para completar contexto recente.
- As respostas de sucesso, escolha de cartão, divisão e próximos passos agora passam por formatação dedicada:
  - `Style Purchase Response`;
  - `Style Conversation Response`.
- Os nós de envio pela Evolution API usam `.first()` para buscar telefone/instância normalizados, reduzindo risco de número vazio quando o item pareado não existe no branch atual.
- O envio para mensagens não suportadas foi mantido, mas com texto mais amigável e exemplo prático.
- As URLs e tokens do AcerttaPay voltaram para variáveis de ambiente, evitando manter segredo dentro do JSON exportado.
- Se o usuário citar o cartão na mensagem, o concierge envia `card_hint` ao AcerttaPay. Quando houver correspondência com um cartão ativo, o app pede confirmação em vez de listar todos os cartões.
- A lista de divisão agora deve exibir também contatos locais: eles entram no controle interno, enquanto somente amigos com Acerto disponível geram rascunho na Central de Acertos.

## Estilo de resposta aplicado

Referência visual extraída dos vídeos enviados:

```txt
✅ título curto

🧾 bloco de resumo
━━━━━━━━━━━━━━━━
🏬 Descrição: *Casas Bahia*
💰 Valor: *R$ 199,90*
💳 Cartão: *Nubank*
🗓️ Fatura: *06/2026*

Próxima ação clara:
Responde *sim* para dividir ou *não* para deixar só com você.
```

Para saudação, o concierge segue esta linha:

```txt
Oi! Eu sou o concierge do AcerttaPay. 🟢

Por aqui, neste piloto, eu já consigo:
• *registrar uma nova compra no cartão*
  Ex.: "Nova compra hoje de R$ 199,90 em Casas Bahia"

Me manda a compra do jeito que você fala mesmo. Se faltar algo, eu pergunto antes de lançar. ✅
```

## Credenciais necessárias

Após importar o workflow, confira estes pontos:

1. Configure as credenciais do nó `Evolution API` em todos os nós de envio.
2. Confirme a credencial do Gemini nos nós:
   - `Gemini Chat Model - Concierge`
   - `Gemini Chat Model - Context Reply`
3. Mantenha as variáveis de ambiente do N8N:
   - `ACERTTAPAY_URL`
   - `ACERTTAPAY_AUTOMATION_API_TOKEN`
   - `EVOLUTION_INSTANCE_NAME`

O fluxo usa fallback local para `http://127.0.0.1:3000` se `ACERTTAPAY_URL` não estiver definido, mas o recomendado em pre-prod/prod é usar variável de ambiente.

## Teste rápido

Payload recebido da Evolution com:

```json
{
  "body": {
    "event": "messages.upsert",
    "instance": "ACERTTAPAY",
    "data": {
      "key": {
        "remoteJid": "5521987993415@s.whatsapp.net",
        "fromMe": false,
        "id": "AC44B07D1657BBC6441FCDAD251CFCC4"
      },
      "message": {
        "conversation": "Oi"
      },
      "messageType": "conversation"
    }
  }
}
```

Deve normalizar para:

```json
{
  "phone": "5521987993415",
  "message_text": "Oi",
  "is_valid_user_message": true
}
```

E seguir para o `AI Concierge Router`, que deve responder como concierge, não tentar criar compra.

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

Resposta esperada: cria a compra no cartão confirmado e pergunta se deseja definir participantes.

```txt
Comprei na Amazon
```

Resposta esperada: pergunta valor e/ou data antes de criar qualquer lançamento.

```txt
R$ 300 em 3x na Amazon hoje
```

Resposta esperada: interpreta parcelamento claro e envia ao AcerttaPay.

## Observação sobre memória

O nó usado é `Window Buffer Memory` por não exigir credenciais extras. Para produção com múltiplos workers ou queue mode, considere trocar para Redis/Postgres Chat Memory usando a mesma session key:

```txt
acerttapay-wa:<telefone>
```

A memória do N8N serve só para contexto conversacional. O estado financeiro sensível continua no AcerttaPay.
