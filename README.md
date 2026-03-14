# Cartões JP App

Aplicação para controle de gastos em cartões, com foco em organização por mês, distribuição por pessoa, acompanhamento de fechamento/vencimento, lançamentos parcelados e geração de resumo para WhatsApp.

O sistema foi evoluído para manter o histórico financeiro preservado, melhorar a experiência de uso no dia a dia e reduzir operações manuais em tarefas recorrentes, como definição do mês de cobrança, gestão de cartões e administração de lançamentos.

## Destaques

- Controle de compras por **cartão**, **mês**, **pessoa** e **parcela**.
- Lançamento manual com **sugestão automática do mês de cobrança** baseada na **data da compra** e no **dia de fechamento do cartão**.
- Compatibilidade com compras **parceladas**, mantendo a divisão automática em parcelas iguais.
- Área de **Resumo** com visão consolidada de pessoas e fechamento dos cartões.
- Área **Geral** com visão mês a mês, detalhamento por cartão e ações em lote.
- Geração de conteúdo para **WhatsApp** com ordenação e layout ajustados.
- **Login com Google**, com criação automática da pessoa titular no primeiro acesso.
- Regras de exclusão seguras, sempre priorizando a **preservação do histórico financeiro**.
- Painel administrativo com exibição condicional para administradores.

---

## Funcionalidades principais

### 1. Gestão de cartões

- Cadastro de cartões com:
  - nome do cartão
  - dia de vencimento
  - dia de fechamento da fatura
- Edição de cartões existentes.
- Opção de **desativar** cartões sem perder histórico.
- Opção de **excluir** cartões **somente quando não houver dependências históricas**.
- Ordenação e exibição preparadas para apoiar o cálculo do mês sugerido no lançamento manual.

### 2. Gestão de pessoas

- Cadastro de pessoas vinculadas ao controle financeiro.
- Definição de titular.
- No primeiro login via Google, o sistema já cria automaticamente uma pessoa com o mesmo nome do usuário e a define como titular.
- Opção de **excluir pessoa** apenas quando isso **não afetar lançamentos passados**.
- Quando a exclusão puder comprometer histórico, a estratégia recomendada é **desativar/ocultar**, preservando os dados já lançados.

### 3. Lançamentos manuais

- Cadastro manual de itens com seleção de:
  - cartão
  - data da compra
  - mês de cobrança / primeiro vencimento
  - valor
  - quantidade de parcelas
  - demais campos já existentes no fluxo
- O formulário foi reorganizado para priorizar a escolha do **cartão antes das demais opções**, já que ele influencia a sugestão automática do mês.
- O sistema sugere automaticamente o mês de cobrança usando a seguinte lógica:
  - compra em dia **anterior** ao fechamento → permanece no **mesmo mês**
  - compra em dia **igual ou posterior** ao fechamento → vai para o **mês seguinte**
- O mês sugerido continua **editável manualmente**.
- A lógica atual de **parcelamento automático** foi preservada.

### 4. Visão mensal

Na aba de acompanhamento mensal:

- remoção do botão de detalhe da distribuição quando a informação já estava exposta na tela
- inclusão de exclusão de itens diretamente pela tela mensal
- confirmação reforçada para ações destrutivas

### 5. Visão geral por mês

A aba `/geral` passou a ter uma navegação mais prática:

- o **primeiro card** exibido é o **mês atual** ou, se ele não existir, o **próximo mês disponível**
- os demais meses ficam organizados em **ordem decrescente**
- ao abrir o card do mês, é possível ver o detalhamento por cartão
- além dos cartões, também é exibido o **valor total de cada cartão** dentro do detalhamento mensal
- foi adicionada a possibilidade de **excluir todos os lançamentos de um cartão diretamente dali**, com confirmação reforçada
- o ícone da área foi atualizado para refletir melhor a função da tela

### 6. Resumo

Na área `/summary`, foram incluídas melhorias de leitura e fechamento:

- exibição do **somatório ao final dos cards**
- ajuste do texto de interface de **“Novo Vencimento”** para **“Vencimento”**
- melhoria na exibição de datas de fechamento/vencimento
- ordenação de vencimentos em **ordem crescente**
- apresentação mais coerente para facilitar conferência mensal

### 7. WhatsApp

A geração de conteúdo para WhatsApp recebeu melhorias visuais e de ordenação:

- correção de corte em nomes de cartões na imagem gerada
- melhor centralização do nome do cartão na listagem
- ordenação dos lançamentos em **ordem decrescente**

### 8. Administração

- A área `/admin` passou a seguir o mesmo padrão visual das demais páginas.
- O link para `/admin` foi incluído no header global, mas aparece **somente para usuários administradores**.
- O botão **Sair** foi padronizado para ficar disponível nos headers das páginas.

---

## Regras de negócio importantes

### Preservação de histórico

Uma diretriz central da ferramenta é:

> nada que comprometa lançamentos passados deve ser apagado de forma irresponsável.

Por isso:

- **pessoas** e **cartões** só podem ser excluídos definitivamente quando não houver histórico relacionado
- se houver risco de quebrar vínculo com dados passados, a exclusão real não deve acontecer
- nesses casos, o caminho seguro é **desativar**, ocultando do uso corrente sem apagar o histórico

### Confirmação reforçada para exclusões

Ações destrutivas receberam uma confirmação explícita de alto atrito.

Exemplo de padrão adotado:

- exigir confirmação expressa por digitação, como **“Eu confirmo”**

Essa abordagem foi adotada para reduzir exclusões acidentais.

---

## Melhorias aplicadas neste ciclo

> A lista abaixo considera as melhorias implantadas **após** a etapa inicial de refatoração de rotas.

### Interface e navegação

- reordenação dos cards da aba `/geral`
- inclusão do link `/admin` no header global apenas para admin
- inclusão do botão `Sair` em todos os headers
- padronização visual da página `/admin`
- troca do ícone da aba `/geral`

### Cadastro e autenticação

- criação automática da pessoa titular no primeiro login com Google
- inclusão de dia de fechamento no cadastro de cartões
- reorganização visual do formulário de lançamento manual

### Resumo e conferência

- somatórios ao final dos cards em `/summary`
- ajuste do texto “Novo Vencimento” para “Vencimento”
- ordenação crescente dos vencimentos
- melhoria no formato de exibição das datas
- exibição do total por cartão no detalhamento mensal de `/geral`

### Lançamentos e automações

- sugestão automática do mês de cobrança com base em:
  - data da compra informada
  - dia de fechamento do cartão
- manutenção da edição manual do mês sugerido
- preservação da lógica de parcelamento automático

### Exclusões seguras

- exclusão individual de itens pela visão mensal
- exclusão em massa de lançamentos de um cartão na visão geral
- opção de desativar e excluir cartões com proteção de histórico
- opção de excluir pessoas com proteção de histórico
- confirmações reforçadas para ações destrutivas

### WhatsApp

- ajustes de layout da imagem
- melhora no alinhamento do nome do cartão
- ordenação decrescente dos lançamentos

---

## Fluxo de uso

### Cadastro inicial

1. o usuário acessa a aplicação
2. autentica com Google
3. no primeiro acesso, a pessoa titular é criada automaticamente
4. o usuário cadastra os cartões com vencimento e fechamento

### Lançamento de compra

1. selecionar o cartão
2. informar a data da compra
3. o sistema sugere o mês de cobrança
4. o usuário pode manter ou alterar manualmente
5. se houver parcelamento, o sistema distribui as parcelas a partir do mês indicado

### Conferência

- `/month` para ver e gerir lançamentos do período
- `/geral` para visualizar meses, cartões e totais agrupados
- `/summary` para visão consolidada de pessoas e vencimentos
- `/whatsapp` para gerar material de compartilhamento

---

## Estrutura funcional da aplicação

### `/cards`
Gestão de cartões, incluindo vencimento, fechamento, desativação e exclusão segura.

### `/people`
Gestão de pessoas, titularidade e exclusão segura sem comprometer histórico.

### `/month`
Controle mensal de lançamentos, conferência e exclusão individual com confirmação reforçada.

### `/geral`
Visão consolidada por mês, detalhamento por cartão, totais e ações em lote.

### `/summary`
Resumo consolidado de pessoas e fechamento de cartões, com somatórios e ordenação por vencimento.

### `/whatsapp`
Geração de conteúdo visual para compartilhamento com melhor ordenação e apresentação.

### `/admin`
Área administrativa com acesso controlado por perfil.

---

## Diferenciais do projeto

- foco em **uso real do dia a dia**, e não apenas em cadastro bruto
- preocupação com **consistência financeira e histórico preservado**
- automação prática sem retirar o controle manual do usuário
- confirmação reforçada para ações críticas
- interface evoluída com base em rotinas reais de uso

---

## Observações para manutenção

Ao evoluir o projeto, é importante manter estas premissas:

- nunca remover ou quebrar comportamentos existentes sem necessidade clara
- toda exclusão deve ser avaliada sob a ótica de preservação de histórico
- automações devem **ajudar**, mas o usuário deve continuar com possibilidade de ajuste manual
- mudanças visuais devem manter o padrão já adotado nas telas principais

---

## Sugestão de roadmap futuro

- filtros avançados por período, pessoa e cartão
- histórico de alterações administrativas
- exportação de relatórios
- dashboard com indicadores mensais
- notificações de fechamento e vencimento
- auditoria de exclusões/desativações

---

## Licença

Defina aqui a licença que você deseja usar no repositório, por exemplo:

- MIT
- Apache-2.0
- uso privado / interno

---

## Autor

Projeto mantido por **Joao Paulo De Mattos Ferreira Vaz**.
