# Smoke de pre-producao - Fase 5B (3.20.10)

Objetivo desta fase: fechar o dominio social-financeiro complementar sem mudar comportamento externo.

## Escopo tocado
- People / perfil / status / foto
- Amizade e pedidos
- Compras comigo
- Pix do perfil
- Share e WhatsApp derivados dessas areas

## Checklist minimo
1. Abrir `/people` e `/settings` logado.
2. Salvar perfil proprio em modo identidade.
3. Salvar assinatura/status do perfil.
4. Enviar foto nova, voltar para default e remover foto.
5. Criar contato novo, editar contato existente e validar bloqueio de nome duplicado.
6. Atualizar Pix do proprio perfil e conferir mensagem de sucesso/erro.
7. Abrir `/people/:id/compras-comigo` e navegar entre meses.
8. Ajustar preferencias de notificacao em `/settings#alerts`.
9. Enviar pedido de amizade para contato apto.
10. Cancelar pedido pendente.
11. Aceitar e recusar pedido recebido.
12. Desfazer amizade existente.
13. Desativar e reativar contato.
14. Tentar excluir contato com bloqueadores e sem bloqueadores.
15. Acessar `/share/:year/:month/:personId`.
16. Acessar `/whatsapp/:year/:month/:personId` como admin.
17. Acessar `/whatsapp/:year/:month/:personId` como nao admin e validar redirect para `/share`.
18. Testar `POST /whatsapp/send-automation` em ambiente controlado.

## Regressao lateral recomendada
- Repetir smoke de `shared-debts` (5A)
- Repetir smoke de `summary/import` (4B)
- Repetir smoke de `cards/finances` (4A)

## Sinal verde esperado
- URLs, redirects, payloads, cookies e UX iguais
- People e amizade seguem integras
- Builders de share/WhatsApp continuam produzindo os mesmos fluxos
