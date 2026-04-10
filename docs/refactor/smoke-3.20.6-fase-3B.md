# Smoke 3.20.6 - Fase 3B

## Escopo
- /admin
- /admin/settings/:section
- /admin/email/test-connection
- /admin/email/send-test
- /admin/backup/*
- /admin/messages/*
- /notifications*

## Smoke minimo em pre-producao
1. Entrar com usuario admin e abrir `/admin`.
2. Validar troca de abas e render das secoes Access, Google, Push, Backup e Email.
3. Salvar uma secao sem mudanca e confirmar mensagem de sucesso neutra.
4. Alterar uma configuracao live e confirmar recarga sem regressao aparente.
5. Alterar uma configuracao com restart e confirmar aviso de reinicio.
6. Executar `POST /admin/email/test-connection` com SMTP valido e invalido.
7. Executar `POST /admin/email/send-test` com destinatario valido.
8. Baixar o guia de backup em `/admin/backup/guide`.
9. Testar conectar e desconectar Google Drive em ambiente controlado.
10. Rodar backup manual e validar status/painel/admin.
11. Testar download do backup local primario e secundario.
12. Testar restauracao apenas com zip controlado de homologacao.
13. Rodar novamente o smoke de `/admin/messages/*` e `/notifications*` para garantir ausencia de regressao lateral.

## Observacoes
- Nao testar restauracao em ambiente com dados produtivos.
- Nao misturar nesta rodada validacoes de month, cards, transactions, people ou shared-debts.
