# Cartões JP (Local Web App) v0.6

## Rodar
```bash
npm install
npm run migrate
npm run seed
npm start
```

Acesse: http://localhost:3000

## PM2
```bash
pm2 start ecosystem.config.js
pm2 save
```

## Novidades v0.6
- Aba Itens: ordenação também pelo **Nº do cartão**.
- Aba Itens: filtros por coluna (Data, Descrição, Cartão, Nº, Valor, Distribuído).
- Resumo restaurado: matriz Pessoa x Cartão + WhatsApp completo (PNG + lista de itens).
