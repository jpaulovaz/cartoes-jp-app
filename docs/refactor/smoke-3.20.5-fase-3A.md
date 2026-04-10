# Smoke minimo - 3.20.5 - Fase 3A

## Objetivo
Validar que auth, lock, PIN, passkeys, notifications/push e admin/messages seguem com o mesmo comportamento externo apos a extracao para router/controller/service/repository.

## Preparacao
- subir a aplicacao com a base de pre-producao habitual
- confirmar que o setup inicial ja esta concluido
- usar um usuario admin e um usuario comum
- manter um aparelho/browser com push habilitado para o teste de notificacao

## Auth e sessao
- abrir `/login` e confirmar tela normal
- executar login Google e confirmar redirect para `/`
- testar `/logout` e confirmar retorno para `/login`
- validar callback legado `/auth/callback`
- validar POST `/login` redirecionando para `/auth/google`

## Lock, PIN e passkeys
- entrar em `/settings#security`
- ligar PIN, trocar PIN, ajustar tempo de idle e desligar PIN
- abrir `/lock` com sessao travada e confirmar render normal
- testar `POST /lock/unlock` com PIN correto e incorreto
- testar `POST /lock/engage` e `POST /lock/touch`
- se o ambiente suportar, registrar passkey, validar unlock por passkey e remover o aparelho
- validar reauth Google em `/lock/reauth/google` e fluxo de recovery setup/disable

## Notifications e push
- testar subscribe e unsubscribe de push
- abrir `/notifications/:id/open`
- marcar tudo como lido e limpar lidos
- validar que os redirects e flashes continuam iguais

## Admin messages
- abrir `/admin/messages`
- exportar CSV
- importar CSV em previa, confirmar e cancelar
- salvar personalizacao, resetar, montar previa e enviar push-test

## Critero de aceite operacional
- nenhuma URL publica muda
- auth guard e admin guard continuam iguais
- login/logout/lock/push/admin messages sem regressao aparente
