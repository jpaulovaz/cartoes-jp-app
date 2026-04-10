# OrganizaPay - Smoke de pre-producao - v3.20.1 - Fase 0B

## Objetivo
Validar que a Fase 0B adicionou a primeira rede minima de seguranca da refatoracao sem alterar URLs, redirects, cookies, payloads criticos, banco ou UX do servico.

## Cobertura automatizada desta fase
Comando padrao:

```bash
npm test
```

Cobertura automatizada incluida nesta rodada:
- helper de boot isolado com banco e sessao temporarios;
- redirect de `/login` para `/setup` em banco vazio;
- setup inaugural com redirect para `/login?setup=done`;
- preservacao do redirect legado de `POST /login` para `/auth/google` depois do setup;
- guards anonimos de `/month/:year/:month`, `/shared-debts` e `/admin/messages` redirecionando para `/login` depois do setup;
- render autenticado de `/month/:year/:month`, `/shared-debts` e `/admin/messages` com sessao valida em ambiente isolado.

## Pre-condicoes para o smoke manual
- Dependencias instaladas no ambiente.
- Backup recente do banco e da pasta de sessao do ambiente validado.
- Variaveis de ambiente e credenciais iguais ao ambiente validado anteriormente.
- Subida padrao preservada com `node server.js` ou `npm start`.
- Restore de backup somente em ambiente controlado.

## Checklist manual de pre-producao

### 1. Login e setup
- [ ] Abrir `/login`.
- [ ] Se o ambiente estiver vazio, confirmar redirect para `/setup`.
- [ ] Se o ambiente ja estiver configurado, concluir login com Google de um usuario ativo.
- [ ] Confirmar que cookies e sessao continuam funcionando sem loop de redirect.

Resultado esperado: sem erro 500, sem regressao de redirect entre `/setup` e `/login`, e sem mudanca no fluxo atual.

### 2. Home e mes
- [ ] Abrir a home autenticada.
- [ ] Abrir `/month/{ano}/{mes}` de um mes valido.
- [ ] Confirmar render da pagina, filtros e links principais.

Resultado esperado: dashboard e tela do mes renderizam normalmente.

### 3. Transacoes
- [ ] Criar uma transacao manual de teste.
- [ ] Editar a transacao criada.
- [ ] Categorizar ou alocar a transacao, se fizer sentido no ambiente.
- [ ] Excluir a transacao de teste.

Resultado esperado: totais, listagens, redirects e mensagens seguem coerentes.

### 4. Cartoes
- [ ] Abrir `/cards`.
- [ ] Criar um cartao de teste ou editar um cartao controlado.
- [ ] Validar ativacao/desativacao e retorno para a tela esperada.

Resultado esperado: listagem e manutencao de cartoes seguem sem regressao aparente.

### 5. Shared debts
- [ ] Abrir `/shared-debts`.
- [ ] Validar abas/listagens principais.
- [ ] Executar um fluxo simples e seguro do ambiente, como abrir um acerto existente ou criar um lembrete avulso de teste.

Resultado esperado: listagem, filtros, detalhes e redirects continuam funcionando.

### 6. Notificacoes
- [ ] Abrir `/notifications`.
- [ ] Validar contadores e abertura de itens.
- [ ] Se o ambiente permitir, executar um teste controlado de leitura ou limpeza.

Resultado esperado: notificacoes continuam acessiveis e sem quebra de sessao.

### 7. Admin/messages
- [ ] Abrir `/admin/messages`.
- [ ] Aplicar um filtro.
- [ ] Abrir a edicao de um template.
- [ ] Executar preview controlado.
- [ ] Exportar CSV do catalogo.

Resultado esperado: tela, preview e export continuam com os mesmos contratos externos.

### 8. Importacao
- [ ] Abrir `/import`.
- [ ] Enviar um arquivo de amostra seguro.
- [ ] Validar preview.
- [ ] Cancelar ou confirmar conforme a politica do ambiente.

Resultado esperado: parsing, preview e redirects seguem estaveis.

### 9. Backup
- [ ] Abrir a area de backup administrativa.
- [ ] Executar um backup manual.
- [ ] Validar geracao/download do arquivo.
- [ ] Fazer restore apenas em ambiente isolado, nunca direto na pre-producao.

Resultado esperado: backup continua operando sem interferir no restante do app.

## Sinais de regressao que bloqueiam a fase
- Importar o app para teste abrir porta automaticamente.
- Scheduler iniciar fora do start normal.
- Redirect anonimo mudar sem motivo entre `/setup` e `/login`.
- Login, mes, shared-debts, admin/messages, importacao ou backup quebrarem apos a fase.
- Mudanca inesperada de cookies, payloads, URLs, redirects ou UX.
