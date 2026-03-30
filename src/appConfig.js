const SETTING_SECTIONS = [
  {
    key: 'google',
    title: 'Login com Google',
    eyebrow: 'Porta de entrada',
    description: 'Aqui mora a chave que abre a porta do app. Sem esse trio, o login com Google tira folga.',
    icon: 'google'
  },
  {
    key: 'whatsapp',
    title: 'WhatsApp automático',
    eyebrow: 'Disparos do resumo',
    description: 'Configura a ponte com a Evolution API para mandar resumos e recadinhos sem drama.',
    icon: 'whatsapp'
  },
  {
    key: 'email',
    title: 'E-mail transacional',
    eyebrow: 'Convites e boas-vindas',
    description: 'Configura o SMTP para o admin disparar boas-vindas, testar a conexão e reenviar convites sem tropeço.',
    icon: 'mail'
  },
  {
    key: 'push',
    title: 'Alertas e push',
    eyebrow: 'Sininho ligado',
    description: 'Chaves web push e rotina dos lembretes de vencimento. É o setor onde o sino aprende a tocar.',
    icon: 'bell'
  },
  {
    key: 'security',
    title: 'Sessão e segurança',
    eyebrow: 'Quem entra e por quanto tempo',
    description: 'Ajusta segredo de sessão e tempo de inatividade. Aqui o app decide quanto tempo pode ficar cochilando.',
    icon: 'shield'
  },
  {
    key: 'sharedDebt',
    title: 'Cobranças entre amigos',
    eyebrow: 'Regra de vínculo',
    description: 'Controla se cobrança automática depende de amizade ativa ou se pode rolar só no match de e-mail.',
    icon: 'friends'
  },
  {
    key: 'backup',
    title: 'Backup e restauração',
    eyebrow: 'Rede de segurança',
    description: 'Define a rotina que guarda a memória do app em dois cantinhos do servidor e, se você quiser, também no Google Drive.',
    icon: 'archive'
  },
  {
    key: 'system',
    title: 'Sistema',
    eyebrow: 'Ajustes da casa',
    description: 'Configurações mais estruturais do servidor. Algumas entram na hora, outras pedem um restart de carinho.',
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
    helper: 'Exemplo: OrganizaPay ou Time AcerttaPay.',
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
    helper: 'Liga ou desliga os pushs que avisam quando a fatura vence no dia.',
    input: 'switch',
    defaultValue: '1',
    required: false,
    autoReload: true
  },
  {
    key: 'CARD_DUE_PUSH_TIMEZONE',
    section: 'push',
    label: 'Fuso horário',
    helper: 'Normalmente America/Sao_Paulo. É o relógio oficial dos lembretes.',
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
    helper: 'Escolha a hora local em que o primeiro lembrete do dia pode sair.',
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
    helper: 'Minuto exato do primeiro lembrete. Zero é o clássico sem suspense.',
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
    key: 'CARD_DUE_PUSH_CHECK_INTERVAL_MINUTES',
    section: 'push',
    label: 'Intervalo de varredura',
    helper: 'De quanto em quanto tempo o servidor checa se há fatura vencendo hoje.',
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
    label: 'Cobrança automática só com amizade ativa',
    helper: 'Ligado: só amigos ativos podem receber cobrança automática. Desligado: o match por e-mail já libera o atalho.',
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
