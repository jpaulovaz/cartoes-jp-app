# Smoke de pre-producao - 3.20.4 - Fase 2 (Rotas no lugar)

## Objetivo
Validar que a primeira casca real de `express.Router()` entrou no app sem mudar comportamento externo.

## Areas movidas nesta fase
- `/push/*`
- `/notifications*`
- `/admin/messages*`

## Checklist minimo

### 1) Auth guard das rotas movidas
- Abrir `/notifications` sem sessao -> deve redirecionar para `/login`
- Abrir `/admin/messages` sem sessao -> deve redirecionar para `/login`
- Fazer `POST /push/subscribe` sem sessao -> deve continuar bloqueado por auth

### 2) Notifications e push
- Com usuario autenticado, abrir `/notifications` -> deve redirecionar para `/geral`
- Marcar aviso como lido por `POST /notifications/:id/read` -> redirect e comportamento iguais ao build anterior
- Abrir aviso por `GET /notifications/:id/open` -> deve marcar como lido e navegar para o mesmo destino anterior
- `POST /notifications/read-all` -> flash e redirect iguais
- `POST /notifications/clear-read` -> flash e redirect iguais
- `POST /push/subscribe` e `POST /push/unsubscribe` -> payload e resposta JSON iguais

### 3) Admin messages
- Usuario comum em `/admin/messages` -> 403 igual ao build anterior
- Admin em `/admin/messages` -> tela renderiza normalmente
- `GET /admin/messages/export.csv` -> baixa CSV normalmente
- `POST /admin/messages/import` -> gera previa normalmente
- `POST /admin/messages/import/confirm` -> aplica lote normalmente
- `POST /admin/messages/import/cancel` -> descarta previa normalmente
- `POST /admin/messages/:messageKey` -> salva personalizacao e volta para a mesma URL
- `POST /admin/messages/:messageKey/reset` -> restaura e volta para a mesma URL
- `POST /admin/messages/:messageKey/preview` -> JSON igual ao build anterior
- `POST /admin/messages/:messageKey/push-test` -> respeita rate limit e resposta JSON igual

### 4) Regressao lateral rapida
- Login completo
- Home autenticada
- `/month/:year/:month`
- `/shared-debts`
- `/admin`

## Criterio de aceite operacional
- URLs publicas identicas
- mesmos params e redirects
- mesmos guards de autenticacao/autorizacao
- mesmo contrato HTML/JSON nos grupos movidos
