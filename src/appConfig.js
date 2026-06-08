const SETTING_SECTIONS = [
  {
    key: 'google',
    title: 'Login com Google',
    eyebrow: 'Porta de entrada',
    description: 'Client ID, secret e retorno do OAuth para o login com Google trabalhar bonito.',
    shortDescription: 'Configura a porta de entrada via Google.',
    group: 'identity',
    icon: 'google'
  },
  {
    key: 'whatsapp',
    title: 'WhatsApp automático',
    eyebrow: 'Disparos do resumo',
    description: 'Ponte com a Evolution API para os envios automáticos de resumo e recados do app.',
    shortDescription: 'Conecta o app ao WhatsApp automático.',
    group: 'messaging',
    icon: 'whatsapp'
  },
  {
    key: 'automation',
    title: 'API de automações',
    eyebrow: 'N8N + IA',
    description: 'Endpoint protegido para o N8N interpretar mensagens do WhatsApp e pedir lançamentos no AcerttaPay.',
    shortDescription: 'Liga a API externa de compras assistidas.',
    group: 'messaging',
    icon: 'sparkles'
  },
  {
    key: 'email',
    title: 'E-mail transacional',
    eyebrow: 'Convites e boas-vindas',
    description: 'SMTP para boas-vindas, testes de entrega e reenvio de convite sem depender de gambiarra.',
    shortDescription: 'Liga o correio do admin e dos convites.',
    group: 'messaging',
    icon: 'mail'
  },
  {
    key: 'push',
    title: 'Alertas e push',
    eyebrow: 'Sininho ligado',
    description: 'Liga o push web, organiza a agenda dos alertas automáticos e mostra quais rotinas do sistema estão ativas.',
    shortDescription: 'Organiza push web, agenda e rotinas automáticas.',
    group: 'messaging',
    icon: 'bell'
  },
  {
    key: 'security',
    title: 'Sessão e segurança',
    eyebrow: 'Quem entra e por quanto tempo',
    description: 'Segredo de sessão, timeout e regras que mexem com a permanência dentro do app.',
    shortDescription: 'Define como a sessão se comporta.',
    group: 'identity',
    icon: 'shield'
  },
  {
    key: 'sharedDebt',
    title: 'Acertos na rede',
    eyebrow: 'Regra de vínculo',
    description: 'Decide quando o acerto automático depende de amizade ativa e quando o e-mail já basta.',
    shortDescription: 'Ajusta a regra de vínculo dos acertos.',
    group: 'rules',
    icon: 'friends'
  },
  {
    key: 'backup',
    title: 'Backup e restauração',
    eyebrow: 'Rede de segurança',
    description: 'Rotina do cofre local, integração com Google Drive e restauração do app.',
    shortDescription: 'Protege a memória do app e cuida do retorno.',
    group: 'operations',
    icon: 'archive'
  },
  {
    key: 'statementPdf',
    title: 'Fatura em PDF com IA',
    eyebrow: 'Importação assistida',
    description: 'Liga o envio de PDF, escolhe os provedores e define como o app guarda a trilha técnica dessa leitura.',
    shortDescription: 'Controla a importação de fatura em PDF com IA.',
    group: 'operations',
    icon: 'sparkles'
  },
  {
    key: 'system',
    title: 'Sistema',
    eyebrow: 'Ajustes da casa',
    description: 'Configurações estruturais do servidor; algumas entram na hora, outras pedem restart.',
    shortDescription: 'Reúne os ajustes mais sensíveis do servidor.',
    group: 'system',
    icon: 'sparkles'
  }
];

const SETTING_DEFINITIONS = [
  {
    key: 'GOOGLE_CLIENT_ID',
    section: 'google',
    label: 'Client ID',
    helper: 'Cole o Client ID do Google OAuth. Sem ele o botão de login fica sem crachá.',
    input: 'text',
    defaultValue: '',
    placeholder: '1234567890-abc.apps.googleusercontent.com',
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'GOOGLE_CLIENT_SECRET',
    section: 'google',
    label: 'Client secret',
    helper: 'Segredo do OAuth. Fica escondidinho, mas continua editável pelo admin.',
    input: 'password',
    defaultValue: '',
    placeholder: 'Cole o segredo do Google',
    secret: true,
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'GOOGLE_CALLBACK_URL',
    section: 'google',
    label: 'URL de retorno',
    helper: 'Normalmente termina em /auth/google/callback. É para onde o Google devolve a pessoa depois do login.',
    input: 'url',
    defaultValue: 'http://localhost:3001/auth/google/callback',
    placeholder: 'https://seu-dominio.com/auth/google/callback',
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'EVOLUTION_API_URL',
    section: 'whatsapp',
    label: 'URL da Evolution API',
    helper: 'Endereço da instância que vai cuidar dos envios automáticos no WhatsApp.',
    input: 'url',
    defaultValue: '',
    placeholder: 'https://sua-instancia.com',
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'EVOLUTION_API_KEY',
    section: 'whatsapp',
    label: 'API key',
    helper: 'Chave de acesso da Evolution API. Aqui ela fica guardada sem aparecer de bandeja.',
    input: 'password',
    defaultValue: '',
    placeholder: 'Cole a API key aqui',
    secret: true,
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'EVOLUTION_INSTANCE_NAME',
    section: 'whatsapp',
    label: 'Nome da instância',
    helper: 'Nome exato da instância usada nos envios automáticos.',
    input: 'text',
    defaultValue: '',
    placeholder: 'MinhaInstancia',
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'AUTOMATION_API_ENABLED',
    section: 'automation',
    label: 'Ativar API do N8N',
    helper: 'Liga os endpoints protegidos de automação. Deixe desligado até o workflow estar testado.',
    input: 'switch',
    defaultValue: '0',
    required: false,
    autoReload: true
  },
  {
    key: 'AUTOMATION_API_TOKEN',
    section: 'automation',
    label: 'Token Bearer da API',
    helper: 'Segredo que o N8N envia no header Authorization. Use um valor longo e exclusivo.',
    input: 'password',
    defaultValue: '',
    placeholder: 'gere-um-token-longo-aqui',
    secret: true,
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'AUTOMATION_HMAC_SECRET',
    section: 'automation',
    label: 'Segredo HMAC',
    helper: 'Reservado para assinatura forte das requisições. Pode ficar vazio no MVP com Bearer token.',
    input: 'password',
    defaultValue: '',
    placeholder: 'opcional-no-mvp',
    secret: true,
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'AUTOMATION_ALLOWED_IPS',
    section: 'automation',
    label: 'IPs permitidos',
    helper: 'Lista opcional separada por vírgula. Vazio libera qualquer IP com token válido.',
    input: 'text',
    defaultValue: '',
    placeholder: '203.0.113.10, 198.51.100.25',
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'AUTOMATION_CONVERSATION_TTL_MINUTES',
    section: 'automation',
    label: 'Tempo da conversa pendente',
    helper: 'Minutos para manter uma escolha de cartão ou divisão esperando resposta pelo WhatsApp.',
    input: 'number',
    defaultValue: '20',
    min: 1,
    max: 180,
    step: 1,
    required: false,
    autoReload: true
  },
  {
    key: 'AUTOMATION_RATE_LIMIT_PER_PHONE_PER_MINUTE',
    section: 'automation',
    label: 'Limite por telefone/minuto',
    helper: 'Freio de segurança para não deixar mensagens repetidas virarem confete financeiro.',
    input: 'number',
    defaultValue: '10',
    min: 1,
    max: 120,
    step: 1,
    required: false,
    autoReload: true
  },
  {
    key: 'AUTOMATION_RATE_LIMIT_PER_KEY_PER_MINUTE',
    section: 'automation',
    label: 'Limite por chave/minuto',
    helper: 'Freio de segurança da API inteira para proteger o app caso o workflow dispare em loop.',
    input: 'number',
    defaultValue: '300',
    min: 10,
    max: 5000,
    step: 10,
    required: false,
    autoReload: true
  },
  {
    key: 'WELCOME_EMAIL_ENABLED',
    section: 'email',
    label: 'Enviar boas-vindas por e-mail',
    helper: 'Liga o disparo do convite de boas-vindas no fluxo do admin. Mesmo desligado, você ainda pode testar a conexão.',
    input: 'switch',
    defaultValue: '1',
    required: false,
    autoReload: true
  },
  {
    key: 'MAIL_SMTP_HOST',
    section: 'email',
    label: 'Host SMTP',
    helper: 'Endereço do servidor SMTP do Mailcow, como mail.seudominio.com.',
    input: 'text',
    defaultValue: '',
    placeholder: 'mail.seudominio.com',
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'MAIL_SMTP_PORT',
    section: 'email',
    label: 'Porta SMTP',
    helper: 'Normalmente 587 com STARTTLS ou 465 com TLS implícito.',
    input: 'number',
    defaultValue: '587',
    min: 1,
    max: 65535,
    step: 1,
    required: false,
    autoReload: true
  },
  {
    key: 'MAIL_SMTP_SECURE',
    section: 'email',
    label: 'Usar TLS implícito',
    helper: 'Ative para conexão segura nativa na porta 465. Desligado costuma casar com a 587 + STARTTLS.',
    input: 'switch',
    defaultValue: '0',
    required: false,
    autoReload: true
  },
  {
    key: 'MAIL_SMTP_REQUIRE_TLS',
    section: 'email',
    label: 'Exigir STARTTLS',
    helper: 'Quando a conexão não for implícita, pede que o servidor suba o TLS antes do envio.',
    input: 'switch',
    defaultValue: '1',
    required: false,
    autoReload: true
  },
  {
    key: 'MAIL_SMTP_USER',
    section: 'email',
    label: 'Usuário SMTP',
    helper: 'Conta da caixa que vai mandar os e-mails. O ideal é uma conta dedicada do tipo acesso@seudominio.com.',
    input: 'text',
    defaultValue: '',
    placeholder: 'acesso@seudominio.com',
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'MAIL_SMTP_PASS',
    section: 'email',
    label: 'Senha SMTP',
    helper: 'Senha da caixa SMTP. Se a conta usar 2FA, prefira uma app password.',
    input: 'password',
    defaultValue: '',
    placeholder: 'Cole a senha da caixa SMTP',
    secret: true,
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'MAIL_FROM_EMAIL',
    section: 'email',
    label: 'E-mail remetente',
    helper: 'Endereço que vai aparecer como remetente do boas-vindas.',
    input: 'text',
    defaultValue: '',
    placeholder: 'acesso@seudominio.com',
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'MAIL_FROM_NAME',
    section: 'email',
    label: 'Nome do remetente',
    helper: 'Exemplo: AcerttaPay ou Time AcerttaPay.',
    input: 'text',
    defaultValue: 'AcerttaPay',
    placeholder: 'AcerttaPay',
    required: false,
    autoReload: true
  },
  {
    key: 'MAIL_REPLY_TO',
    section: 'email',
    label: 'Reply-to (opcional)',
    helper: 'Se quiser que as respostas caiam em outra caixa, informe aqui.',
    input: 'text',
    defaultValue: '',
    placeholder: 'ola@seudominio.com',
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'WELCOME_EMAIL_SUBJECT',
    section: 'email',
    label: 'Assunto padrão do boas-vindas',
    helper: 'Assunto usado quando o admin não personaliza nada. Curto, direto e sem novela.',
    input: 'text',
    defaultValue: 'Seu acesso ao AcerttaPay foi liberado',
    placeholder: 'Seu acesso ao AcerttaPay foi liberado',
    required: false,
    autoReload: true,
    fullWidth: true
  },
  {
    key: 'WELCOME_EMAIL_LOGIN_URL',
    section: 'email',
    label: 'Link de entrada (opcional)',
    helper: 'Se ficar em branco, o app monta o link com base no endereço atual do Admin.',
    input: 'url',
    defaultValue: '',
    placeholder: 'https://acerttapay.com.br/login',
    monospace: true,
    required: false,
    autoReload: true,
    fullWidth: true
  },
  {
    key: 'VAPID_PUBLIC_KEY',
    section: 'push',
    label: 'Chave pública VAPID',
    helper: 'Essa chave vai para o navegador para habilitar push web. Pode aparecer no app sem drama.',
    input: 'textarea',
    rows: 3,
    defaultValue: '',
    placeholder: 'Cole a public key aqui',
    monospace: true,
    required: false,
    autoReload: true,
    fullWidth: true
  },
  {
    key: 'VAPID_PRIVATE_KEY',
    section: 'push',
    label: 'Chave privada VAPID',
    helper: 'É a parte sensível do par VAPID. Fica escondida, mas pode ser atualizada por aqui.',
    input: 'password',
    rows: 3,
    defaultValue: '',
    placeholder: 'Cole a private key aqui',
    monospace: true,
    secret: true,
    required: false,
    autoReload: true,
    fullWidth: true
  },
  {
    key: 'VAPID_SUBJECT',
    section: 'push',
    label: 'Subject VAPID',
    helper: 'Use mailto:seuemail@dominio.com ou uma URL. É o cartão de visita dos envios push.',
    input: 'text',
    defaultValue: 'mailto:no-reply@acerttapay.local',
    placeholder: 'mailto:voce@dominio.com',
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'CARD_DUE_PUSH_ENABLED',
    section: 'push',
    label: 'Lembrar vencimento da fatura',
    helper: 'Liga ou pausa a rotina automática que avisa quando a fatura vence no dia.',
    input: 'switch',
    defaultValue: '1',
    required: false,
    autoReload: true
  },
  {
    key: 'CARD_DUE_PUSH_TIMEZONE',
    section: 'push',
    label: 'Fuso horário',
    helper: 'Normalmente America/Sao_Paulo. Esse relógio vale para os alertas automáticos do sistema, não só para a fatura.',
    input: 'text',
    defaultValue: 'America/Sao_Paulo',
    placeholder: 'America/Sao_Paulo',
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'CARD_DUE_PUSH_HOUR',
    section: 'push',
    label: 'Hora do primeiro aviso',
    helper: 'Escolha a hora local em que a agenda automática do sistema pode começar a trabalhar no dia.',
    input: 'number',
    defaultValue: '10',
    min: 0,
    max: 23,
    step: 1,
    required: false,
    autoReload: true
  },
  {
    key: 'CARD_DUE_PUSH_MINUTE',
    section: 'push',
    label: 'Minuto do primeiro aviso',
    helper: 'Minuto exato em que a agenda automática entra em campo. Zero é o clássico sem suspense.',
    input: 'number',
    defaultValue: '0',
    min: 0,
    max: 59,
    step: 1,
    required: false,
    autoReload: true
  },
  {
    key: 'CARD_DUE_PUSH_MAX_SENDS_PER_DAY',
    section: 'push',
    label: 'Máximo de envios por dia',
    helper: 'Quantas vezes o app pode lembrar da fatura no mesmo dia.',
    input: 'number',
    defaultValue: '1',
    min: 0,
    max: 5,
    step: 1,
    required: false,
    autoReload: true
  },
  {
    key: 'CARD_DUE_PUSH_REPEAT_INTERVAL_MINUTES',
    section: 'push',
    label: 'Intervalo entre lembretes',
    helper: 'Só entra em cena quando o máximo diário é maior que 1. Use minutos.',
    input: 'number',
    defaultValue: '0',
    min: 0,
    max: 1440,
    step: 1,
    required: false,
    autoReload: true
  },
  {
    key: 'MONTHLY_FINANCE_DATE_ALERT_ENABLED',
    section: 'push',
    label: 'Datas do mês ligadas',
    helper: 'Liga ou pausa os alertas automáticos de grana que entra e grana que sai. Eles criam aviso interno e tentam push quando o sininho estiver pronto.',
    input: 'switch',
    defaultValue: '1',
    required: false,
    autoReload: true
  },
  {
    key: 'DATE_DRIVEN_ALERTS_ENABLED',
    section: 'push',
    label: 'Datas combinadas ligadas',
    helper: 'Liga ou pausa os alertas automáticos de acertos avulsos com data e lembretes privados com data. Eles criam aviso interno e tentam push quando disponível.',
    input: 'switch',
    defaultValue: '1',
    required: false,
    autoReload: true
  },
  {
    key: 'CARD_DUE_PUSH_CHECK_INTERVAL_MINUTES',
    section: 'push',
    label: 'Intervalo de varredura',
    helper: 'De quanto em quanto tempo o servidor revisita as rotinas automáticas para ver se tem alerta batendo na porta.',
    input: 'number',
    defaultValue: '10',
    min: 1,
    max: 120,
    step: 1,
    required: false,
    autoReload: true
  },
  {
    key: 'SESSION_SECRET',
    section: 'security',
    label: 'Segredo da sessão',
    helper: 'Protege os cookies de sessão. Mudou aqui, vale reiniciar para a nova chave entrar em campo.',
    input: 'password',
    defaultValue: 'chave-secreta-padrao',
    placeholder: 'Use uma chave longa e aleatória',
    secret: true,
    monospace: true,
    required: true,
    restartRequired: true
  },
  {
    key: 'INACTIVITY_TIMEOUT_MINUTES',
    section: 'security',
    label: 'Tempo de inatividade (minutos)',
    helper: 'Se ficar em 0, o app não desloga por inatividade. Se quiser disciplina, coloque um número maior.',
    input: 'number',
    defaultValue: '0',
    min: 0,
    max: 10080,
    step: 1,
    required: false,
    autoReload: true
  },
  {
    key: 'FRIENDSHIP_GATE_SHARED_DEBT_ENABLED',
    section: 'sharedDebt',
    label: 'Acerto automático só com amizade ativa',
    helper: 'Ligado: só amizades ativas podem receber acerto automático. Desligado: o match por e-mail já libera o atalho.',
    input: 'switch',
    defaultValue: '1',
    required: false,
    autoReload: true
  },
  {
    key: 'BACKUP_ENABLED',
    section: 'backup',
    label: 'Backup automático ligado',
    helper: 'Quando ligado, o servidor cria backups sozinho na periodicidade escolhida. O botão manual continua disponível de todo jeito.',
    input: 'switch',
    defaultValue: '1',
    required: false,
    autoReload: true
  },
  {
    key: 'BACKUP_FREQUENCY',
    section: 'backup',
    label: 'Periodicidade',
    helper: 'Escolha o ritmo do backup automático. Manual deixa a automação de folga e mantém só o botão de executar agora.',
    input: 'select',
    defaultValue: 'daily',
    options: [
      { value: 'manual', label: 'Só manual' },
      { value: 'hourly', label: 'A cada hora' },
      { value: 'daily', label: 'Todo dia' },
      { value: 'weekly', label: 'Toda semana' }
    ],
    required: true,
    autoReload: true
  },
  {
    key: 'BACKUP_TIMEZONE',
    section: 'backup',
    label: 'Fuso horário do backup',
    helper: 'Relógio usado para calcular as execuções automáticas. O clássico da casa é America/Sao_Paulo.',
    input: 'text',
    defaultValue: 'America/Sao_Paulo',
    placeholder: 'America/Sao_Paulo',
    monospace: true,
    required: true,
    autoReload: true
  },
  {
    key: 'BACKUP_HOUR',
    section: 'backup',
    label: 'Hora preferida',
    helper: 'Usada nos modos diário e semanal. No modo por hora ela serve só como referência visual.',
    input: 'number',
    defaultValue: '3',
    min: 0,
    max: 23,
    step: 1,
    required: false,
    autoReload: true
  },
  {
    key: 'BACKUP_MINUTE',
    section: 'backup',
    label: 'Minuto preferido',
    helper: 'Minuto exato do disparo automático para os modos diário e semanal.',
    input: 'number',
    defaultValue: '30',
    min: 0,
    max: 59,
    step: 1,
    required: false,
    autoReload: true
  },
  {
    key: 'BACKUP_WEEKDAY',
    section: 'backup',
    label: 'Dia da semana',
    helper: 'Entra em cena quando a periodicidade está em toda semana.',
    input: 'select',
    defaultValue: '0',
    options: [
      { value: '0', label: 'Domingo' },
      { value: '1', label: 'Segunda-feira' },
      { value: '2', label: 'Terça-feira' },
      { value: '3', label: 'Quarta-feira' },
      { value: '4', label: 'Quinta-feira' },
      { value: '5', label: 'Sexta-feira' },
      { value: '6', label: 'Sábado' }
    ],
    required: true,
    autoReload: true
  },
  {
    key: 'BACKUP_KEEP_COUNT',
    section: 'backup',
    label: 'Quantidade de backups para guardar',
    helper: 'O app mantém só os mais recentes em cada destino para o servidor não virar acumulador compulsivo.',
    input: 'number',
    defaultValue: '15',
    min: 1,
    max: 180,
    step: 1,
    required: true,
    autoReload: true
  },
  {
    key: 'BACKUP_LOCAL_PRIMARY_DIR',
    section: 'backup',
    label: 'Pasta local principal',
    helper: 'Pode ser relativa ao projeto ou absoluta no servidor. É a primeira cópia do cofre.',
    input: 'text',
    defaultValue: 'data/backups/local-principal',
    placeholder: 'data/backups/local-principal',
    monospace: true,
    required: true,
    autoReload: true,
    fullWidth: true
  },
  {
    key: 'BACKUP_LOCAL_SECONDARY_DIR',
    section: 'backup',
    label: 'Pasta local espelho',
    helper: 'Segunda cópia local para não depender de um lugar só. Vale outra pasta ou outro volume do servidor.',
    input: 'text',
    defaultValue: 'data/backups/local-espelho',
    placeholder: 'data/backups/local-espelho',
    monospace: true,
    required: true,
    autoReload: true,
    fullWidth: true
  },
  {
    key: 'BACKUP_GOOGLE_ENABLED',
    section: 'backup',
    label: 'Mandar cópia para o Google Drive',
    helper: 'Liga o envio extra para a nuvem. A conexão da conta Google é feita no bloco logo abaixo da seção.',
    input: 'switch',
    defaultValue: '0',
    required: false,
    autoReload: true
  },
  {
    key: 'BACKUP_GOOGLE_FOLDER_NAME',
    section: 'backup',
    label: 'Nome da pasta no Google Drive',
    helper: 'Se a pasta ainda não existir, o AcerttaPay cria uma com esse nome na conta conectada.',
    input: 'text',
    defaultValue: 'AcerttaPay Backups',
    placeholder: 'AcerttaPay Backups',
    required: true,
    autoReload: true
  },
  {
    key: 'STATEMENT_PDF_ENABLED',
    section: 'statementPdf',
    label: 'Liberar PDF em /import',
    helper: 'Liga o bloco Trazer PDF na mesma tela do CSV.',
    input: 'switch',
    defaultValue: '1',
    required: false,
    autoReload: true
  },
  {
    key: 'STATEMENT_PDF_GEMINI_ENABLED',
    section: 'statementPdf',
    label: 'Usar Gemini',
    helper: 'Quando ligado e com chave válida, o Gemini entra como primeiro leitor da fatura.',
    input: 'switch',
    defaultValue: '1',
    required: false,
    autoReload: true
  },
  {
    key: 'STATEMENT_PDF_OPENAI_ENABLED',
    section: 'statementPdf',
    label: 'Usar OpenAI',
    helper: 'Pode trabalhar sozinho ou como segunda opinião quando o Gemini deixar dúvida.',
    input: 'switch',
    defaultValue: '0',
    required: false,
    autoReload: true
  },
  {
    key: 'STATEMENT_PDF_GEMINI_API_KEY',
    section: 'statementPdf',
    label: 'Chave da Gemini API',
    helper: 'Chave usada para ler a fatura pelo Gemini.',
    input: 'password',
    defaultValue: '',
    placeholder: 'Cole a chave da Gemini API',
    secret: true,
    monospace: true,
    required: false,
    autoReload: true,
    fullWidth: true
  },
  {
    key: 'STATEMENT_PDF_OPENAI_API_KEY',
    section: 'statementPdf',
    label: 'Chave da OpenAI API',
    helper: 'Chave usada para a revalidação ou para o fluxo principal quando só a OpenAI estiver ligada.',
    input: 'password',
    defaultValue: '',
    placeholder: 'Cole a chave da OpenAI API',
    secret: true,
    monospace: true,
    required: false,
    autoReload: true,
    fullWidth: true
  },
  {
    key: 'STATEMENT_PDF_GEMINI_MODEL',
    section: 'statementPdf',
    label: 'Modelo Gemini',
    helper: 'Modelo padrão do Gemini para a leitura estruturada da fatura.',
    input: 'text',
    defaultValue: 'gemini-3.1-pro-preview',
    placeholder: 'gemini-3.1-pro-preview',
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'STATEMENT_PDF_OPENAI_MODEL',
    section: 'statementPdf',
    label: 'Modelo OpenAI',
    helper: 'Modelo padrão da OpenAI para a segunda checagem ou leitura principal.',
    input: 'text',
    defaultValue: 'gpt-4.1',
    placeholder: 'gpt-4.1',
    monospace: true,
    required: false,
    autoReload: true
  },
  {
    key: 'STATEMENT_PDF_PROVIDER_TIMEOUT_MS',
    section: 'statementPdf',
    label: 'Timeout do provedor (ms)',
    helper: 'Quanto tempo o app espera a IA antes de marcar timeout. Se a fatura vier maratonista, esse folego extra ajuda.',
    input: 'number',
    defaultValue: '360000',
    min: 30000,
    max: 900000,
    step: 1000,
    required: false,
    autoReload: true
  },
  {
    key: 'STATEMENT_PDF_DEBUG_ENABLED',
    section: 'statementPdf',
    label: 'Guardar trilha técnica de debug',
    helper: 'Mantém texto extraído, retorno bruto do provedor e JSON normalizado para diagnóstico no preprod.',
    input: 'switch',
    defaultValue: '0',
    required: false,
    autoReload: true
  },
  {
    key: 'STATEMENT_PDF_RETENTION_DAYS',
    section: 'statementPdf',
    label: 'Retenção dos artefatos (dias)',
    helper: 'Quantos dias o app guarda PDF, JSON e CSV gerados antes de fazer a faxina automática.',
    input: 'number',
    defaultValue: '7',
    min: 1,
    max: 90,
    step: 1,
    required: true,
    autoReload: true
  },
  {
    key: 'STATEMENT_PDF_MAX_RETRIES',
    section: 'statementPdf',
    label: 'Tentativas máximas por job',
    helper: 'Limite saudável para nova tentativa antes de assumir que a fatura precisa de mais cuidado humano.',
    input: 'number',
    defaultValue: '2',
    min: 0,
    max: 5,
    step: 1,
    required: true,
    autoReload: true
  },
  {
    key: 'PORT',
    section: 'system',
    label: 'Porta do servidor',
    helper: 'Porta usada pelo app na próxima inicialização. Essa aqui pede restart para acordar no novo endereço.',
    input: 'number',
    defaultValue: '3001',
    min: 1,
    max: 65535,
    step: 1,
    required: true,
    restartRequired: true,
    monospace: true
  }
];

const DEFINITION_MAP = new Map(SETTING_DEFINITIONS.map((definition) => [definition.key, definition]));
const SECTION_MAP = new Map(SETTING_SECTIONS.map((section) => [section.key, section]));

function parseBooleanSetting(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', 'sim', 's'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function parseIntegerSetting(value, fallback, { min = null, max = null } = {}) {
  const parsed = Number(String(value ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(parsed)) return fallback;

  let result = Math.trunc(parsed);
  if (min != null && result < min) result = min;
  if (max != null && result > max) result = max;
  return result;
}

function getSettingDefinition(key) {
  return DEFINITION_MAP.get(key) || null;
}

function getSettingSection(sectionKey) {
  return SECTION_MAP.get(sectionKey) || null;
}

function getSettingDefinitionsBySection(sectionKey) {
  return SETTING_DEFINITIONS.filter((definition) => definition.section === sectionKey);
}

function buildSeedValue(definition, env = process.env) {
  const envValue = env && Object.prototype.hasOwnProperty.call(env, definition.key)
    ? env[definition.key]
    : undefined;
  if (envValue != null && envValue !== '') return String(envValue);
  return String(definition.defaultValue ?? '');
}

function sanitizeSettingValue(definition, rawValue) {
  const value = rawValue == null ? '' : String(rawValue).trim();

  if (definition.input === 'switch') {
    return parseBooleanSetting(value, parseBooleanSetting(definition.defaultValue, false)) ? '1' : '0';
  }

  if (definition.input === 'select') {
    const options = Array.isArray(definition.options)
      ? definition.options.map((option) => String(option && typeof option === 'object' ? option.value : option))
      : [];
    const fallback = String(definition.defaultValue ?? '');
    const nextValue = value === '' ? fallback : value;
    if (options.length && !options.includes(nextValue)) {
      throw new Error(`${definition.label} precisa usar uma das opções disponíveis.`);
    }
    return nextValue;
  }

  if (definition.input === 'number') {
    const fallback = parseIntegerSetting(definition.defaultValue, 0, {
      min: definition.min ?? null,
      max: definition.max ?? null
    });
    const parsed = parseIntegerSetting(value === '' ? definition.defaultValue : value, fallback, {
      min: definition.min ?? null,
      max: definition.max ?? null
    });
    return String(parsed);
  }

  if (definition.required && !value) {
    throw new Error(`${definition.label} não pode ficar em branco.`);
  }

  if ((definition.input === 'url' || definition.key === 'GOOGLE_CALLBACK_URL') && value) {
    try {
      // eslint-disable-next-line no-new
      new URL(value);
    } catch (error) {
      throw new Error(`${definition.label} precisa ser uma URL válida.`);
    }
  }

  if (definition.key === 'VAPID_SUBJECT' && value) {
    const lower = value.toLowerCase();
    if (!lower.startsWith('mailto:') && !lower.startsWith('http://') && !lower.startsWith('https://')) {
      throw new Error('O subject VAPID precisa começar com mailto:, http:// ou https://.');
    }
  }

  if (definition.key === 'SESSION_SECRET' && value && value.length < 16) {
    throw new Error('O segredo da sessão precisa ter pelo menos 16 caracteres para não cochilar no ponto.');
  }

  if (['MAIL_FROM_EMAIL', 'MAIL_REPLY_TO', 'MAIL_SMTP_USER'].includes(definition.key) && value) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      throw new Error(`${definition.label} precisa ser um e-mail válido.`);
    }
  }

  if (definition.key === 'MAIL_SMTP_HOST' && value) {
    if (/\s/.test(value) || value.includes('/')) {
      throw new Error('O host SMTP precisa ser só o endereço do servidor, sem barras nem espaços.');
    }
  }

  if (definition.key === 'BACKUP_TIMEZONE' && value) {
    try {
      Intl.DateTimeFormat('pt-BR', { timeZone: value }).format(new Date());
    } catch (error) {
      throw new Error('O fuso do backup precisa ser um identificador válido, tipo America/Sao_Paulo.');
    }
  }

  if ((definition.key === 'BACKUP_LOCAL_PRIMARY_DIR' || definition.key === 'BACKUP_LOCAL_SECONDARY_DIR') && value) {
    if (value.includes('\u0000')) {
      throw new Error(`${definition.label} tem um caractere esquisito no caminho e não dá para salvar assim.`);
    }
  }

  if (definition.key === 'BACKUP_GOOGLE_FOLDER_NAME' && value) {
    if (/[\\/]/.test(value)) {
      throw new Error('O nome da pasta do Google Drive não pode ter barras.');
    }
  }

  return value;
}

function getSectionTitle(sectionKey) {
  return getSettingSection(sectionKey)?.title || sectionKey;
}

module.exports = {
  SETTING_SECTIONS,
  SETTING_DEFINITIONS,
  getSettingDefinition,
  getSettingDefinitionsBySection,
  getSettingSection,
  getSectionTitle,
  buildSeedValue,
  parseBooleanSetting,
  parseIntegerSetting,
  sanitizeSettingValue
};
