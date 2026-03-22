function stripDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const PIX_DEFAULT_STATE = 'RJ';
const PIX_DEFAULT_CITY = 'Rio de Janeiro';

const PIX_STATE_OPTIONS = [
  { code: 'AC', name: 'Acre' },
  { code: 'AL', name: 'Alagoas' },
  { code: 'AP', name: 'Amapá' },
  { code: 'AM', name: 'Amazonas' },
  { code: 'BA', name: 'Bahia' },
  { code: 'CE', name: 'Ceará' },
  { code: 'DF', name: 'Distrito Federal' },
  { code: 'ES', name: 'Espírito Santo' },
  { code: 'GO', name: 'Goiás' },
  { code: 'MA', name: 'Maranhão' },
  { code: 'MT', name: 'Mato Grosso' },
  { code: 'MS', name: 'Mato Grosso do Sul' },
  { code: 'MG', name: 'Minas Gerais' },
  { code: 'PA', name: 'Pará' },
  { code: 'PB', name: 'Paraíba' },
  { code: 'PR', name: 'Paraná' },
  { code: 'PE', name: 'Pernambuco' },
  { code: 'PI', name: 'Piauí' },
  { code: 'RJ', name: 'Rio de Janeiro' },
  { code: 'RN', name: 'Rio Grande do Norte' },
  { code: 'RS', name: 'Rio Grande do Sul' },
  { code: 'RO', name: 'Rondônia' },
  { code: 'RR', name: 'Roraima' },
  { code: 'SC', name: 'Santa Catarina' },
  { code: 'SP', name: 'São Paulo' },
  { code: 'SE', name: 'Sergipe' },
  { code: 'TO', name: 'Tocantins' }
];

const PIX_CITY_SUGGESTIONS_BY_STATE = {
  AC: ['Rio Branco', 'Cruzeiro do Sul', 'Sena Madureira', 'Tarauacá', 'Brasiléia'],
  AL: ['Maceió', 'Arapiraca', 'Palmeira dos Índios', 'Rio Largo'],
  AP: ['Macapá', 'Santana', 'Laranjal do Jari', 'Oiapoque'],
  AM: ['Manaus', 'Parintins', 'Itacoatiara', 'Manacapuru', 'Coari'],
  BA: ['Salvador', 'Feira de Santana', 'Vitória da Conquista', 'Camaçari', 'Juazeiro', 'Itabuna', 'Ilhéus', 'Lauro de Freitas'],
  CE: ['Fortaleza', 'Caucaia', 'Juazeiro do Norte', 'Maracanaú', 'Sobral'],
  DF: ['Brasília'],
  ES: ['Vitória', 'Vila Velha', 'Serra', 'Cariacica', 'Linhares', 'Colatina'],
  GO: ['Goiânia', 'Aparecida de Goiânia', 'Anápolis', 'Rio Verde', 'Luziânia'],
  MA: ['São Luís', 'Imperatriz', 'Caxias', 'Timon'],
  MT: ['Cuiabá', 'Várzea Grande', 'Rondonópolis', 'Sinop', 'Sorriso'],
  MS: ['Campo Grande', 'Dourados', 'Três Lagoas', 'Corumbá'],
  MG: ['Belo Horizonte', 'Uberlândia', 'Contagem', 'Juiz de Fora', 'Betim', 'Montes Claros', 'Uberaba'],
  PA: ['Belém', 'Ananindeua', 'Santarém', 'Marabá', 'Castanhal'],
  PB: ['João Pessoa', 'Campina Grande', 'Santa Rita', 'Patos'],
  PR: ['Curitiba', 'Londrina', 'Maringá', 'Ponta Grossa', 'Cascavel', 'Foz do Iguaçu'],
  PE: ['Recife', 'Jaboatão dos Guararapes', 'Olinda', 'Caruaru', 'Petrolina'],
  PI: ['Teresina', 'Parnaíba', 'Picos', 'Floriano'],
  RJ: ['Rio de Janeiro', 'Niterói', 'São Gonçalo', 'Duque de Caxias', 'Nova Iguaçu', 'Petrópolis', 'Campos dos Goytacazes', 'Volta Redonda', 'Macaé'],
  RN: ['Natal', 'Mossoró', 'Parnamirim', 'Caicó'],
  RS: ['Porto Alegre', 'Caxias do Sul', 'Canoas', 'Pelotas', 'Santa Maria', 'Novo Hamburgo'],
  RO: ['Porto Velho', 'Ji-Paraná', 'Ariquemes', 'Vilhena'],
  RR: ['Boa Vista', 'Rorainópolis', 'Caracaraí'],
  SC: ['Florianópolis', 'Joinville', 'Blumenau', 'São José', 'Chapecó', 'Itajaí', 'Criciúma'],
  SP: ['São Paulo', 'Guarulhos', 'Campinas', 'São Bernardo do Campo', 'Santo André', 'Osasco', 'Santos', 'Ribeirão Preto', 'São José dos Campos', 'Sorocaba', 'Barueri'],
  SE: ['Aracaju', 'Nossa Senhora do Socorro', 'Lagarto', 'Itabaiana'],
  TO: ['Palmas', 'Araguaína', 'Gurupi', 'Porto Nacional']
};

const PIX_ALL_CITY_SUGGESTIONS = Array.from(new Set(
  Object.values(PIX_CITY_SUGGESTIONS_BY_STATE).flat().filter(Boolean)
)).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

function normalizePixState(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  return PIX_STATE_OPTIONS.some((state) => state.code === normalized) ? normalized : null;
}

function guessPixStateByCity(city) {
  const safeCity = stripDiacritics(city).toLowerCase().trim();
  if (!safeCity) return null;

  for (const [stateCode, cities] of Object.entries(PIX_CITY_SUGGESTIONS_BY_STATE)) {
    const found = (cities || []).some((entry) => stripDiacritics(entry).toLowerCase() === safeCity);
    if (found) return stateCode;
  }

  return null;
}

module.exports = {
  PIX_DEFAULT_STATE,
  PIX_DEFAULT_CITY,
  PIX_STATE_OPTIONS,
  PIX_CITY_SUGGESTIONS_BY_STATE,
  PIX_ALL_CITY_SUGGESTIONS,
  normalizePixState,
  guessPixStateByCity
};
