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
    defaultValue: 'mailto:no-reply@organizapay.local',
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
