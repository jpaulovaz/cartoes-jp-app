#!/bin/bash

echo "⚠️  ATENÇÃO: Este script vai DELETAR o banco de dados e recriá-lo!"
echo "Todos os dados serão perdidos!"
echo ""
read -p "Tem certeza? (s/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Ss]$ ]]; then
  echo "Cancelado."
  exit 1
fi

echo "Parando o servidor..."
pm2 stop cartoes-jp

echo "Deletando banco de dados antigo..."
rm -f app.db app.db-shm app.db-wal sessions.sqlite

echo "Iniciando servidor para recriar o banco..."
pm2 start cartoes-jp

echo "Aguardando 5 segundos para o servidor iniciar..."
sleep 5

echo "Verificando logs..."
pm2 logs cartoes-jp --lines 20

echo ""
echo "✅ Banco de dados recriado!"
echo ""
echo "Próximas etapas:"
echo "1. Acesse http://localhost:3001"
echo "2. Faça login com admin/suasenha123"
echo "3. Crie um titular"
echo "4. Crie um cartão"
echo "5. Teste o botão '+Novo Item'"
