// Datos extraídos de Motores.xlsx (hojas "Engine" y "Extras").
// Correcciones aplicadas al Excel original:
//  - Valores que Excel convirtió en fechas (p. ej. F4 "3.2" -> 3-feb) se han restaurado a número.
//  - Rareza 0.7 (F12, Turbine) se interpreta como 0.07 (legendario), en línea con 0.5 / 0.28 / 0.15.
//  - W16 pasa de 0.28 a 0.07: es el motor más fuerte y no tenía sentido que fuera "poco común".
//  - Cilindradas sin rareza/precio (1.2L-2.6L y 10.9L-12.3L) se completan por interpolación.

// Rarezas (6 niveles). `odds` = probabilidad (%) de que salga una pieza de esa rareza
// en el sistema nuevo; `max` = probabilidad tras completar la investigación de I+D.
// `weight` = peso por pieza del sistema clásico (solo niveles 1-4 antiguos).
export const RARITY = {
  1: { key: 1, name: 'Común', weight: 0.5, color: '#b9b4a8', odds: 50, max: 19 },
  2: { key: 2, name: 'Poco común', weight: 0.28, color: '#5fd38d', odds: 25, max: 19 },
  3: { key: 3, name: 'Raro', weight: 0.15, color: '#4fa8ff', odds: 12.5, max: 19 },
  4: { key: 4, name: 'Épico', weight: 0.07, color: '#b56cff', odds: 6.25, max: 19 },
  5: { key: 5, name: 'Legendario', weight: 0.07, color: '#ffb627', odds: 4.375, max: 19 },
  6: { key: 6, name: 'Exótico', weight: 0.07, color: '#ff4d6d', odds: 1.875, max: 5 },
};
// Peso clásico por pieza a partir de su rareza ANTIGUA (1-4).
const CLASSIC_W = { 1: 0.5, 2: 0.28, 3: 0.15, 4: 0.07 };
const tierFromWeight = (w) => (w >= 0.5 ? 1 : w >= 0.28 ? 2 : w >= 0.15 ? 3 : 4);

// [nombre, fuerza, rareza(peso), espacio, precio]
const ENGINE_ROWS = [
  ['In-Line 3', 1.0, 0.28, 1, 1.05],
  ['In-Line 4', 1.5, 0.5, 1, 1.1],
  ['In-Line 5', 1.75, 0.5, 2, 1.3],
  ['In-Line 6', 2.0, 0.5, 2, 1.2],
  ['In-Line 7', 1.5, 0.15, 3, 1.5],
  ['V4', 2.0, 0.28, 1, 1.2],
  ['V5', 2.25, 0.28, 1, 1.4],
  ['V6', 2.5, 0.5, 1, 1.3],
  ['V7', 2.75, 0.15, 1, 1.5],
  ['V8', 3.0, 0.5, 1, 1.4],
  ['V9', 3.25, 0.15, 2, 1.6],
  ['V10', 3.5, 0.5, 2, 1.5],
  ['V11', 3.75, 0.15, 3, 1.7],
  ['V12', 4.0, 0.28, 3, 1.6],
  ['W16', 5.0, 0.07, 2, 1.9],
  ['V16', 4.5, 0.15, 3, 2.1],
  ['H16', 3.0, 0.15, 3, 2.3],
  ['H4', 1.0, 0.15, 2, 1.6],
  ['H6', 1.1, 0.15, 3, 1.7],
  ['H8', 1.25, 0.15, 3, 1.8],
  ['H10', 1.5, 0.15, 3, 1.9],
  ['H12', 1.75, 0.15, 3, 2.1],
  ['Rotativo 1', 1.5, 0.28, 1, 1.3],
  ['Rotativo 2', 2.0, 0.28, 1, 1.45],
  ['Rotativo 3', 2.5, 0.15, 1, 1.6],
  ['Turbina', 1.0, 0.07, 2, 1.75],
  ['F4', 3.2, 0.15, 1, 1.7],
  ['F6', 3.4, 0.28, 1, 1.55],
  ['F8', 3.6, 0.15, 1, 1.75],
  ['F10', 3.8, 0.15, 2, 1.96],
  ['F12', 4.0, 0.07, 2, 2.35],
  ['VR4', 1.7, 0.15, 1, 1.3],
  ['VR6', 1.9, 0.28, 1, 1.4],
  ['VR8', 2.05, 0.15, 1, 1.6],
  ['VR12', 2.3, 0.15, 2, 1.8],
  ['V12 Invertido', 3.6, 0.15, 3, 1.8],
];
// REEQUILIBRADO: la rareza de un motor ahora depende de su fuerza (antes V6, V8 y V10 eran "comunes").
//   fuerza < 2 -> Común · 2 a 2.99 -> Poco común · 3 a 3.99 -> Raro · >= 4 -> Legendario (la Turbina se mantiene legendaria).
const classicEngineTier = (name, p) => (name === 'Turbina' ? 4 : p >= 4 ? 4 : p >= 3 ? 3 : p >= 2 ? 2 : 1);
// Rarezas actuales (6 niveles). Los motores no listados conservan su rareza anterior
// (los antiguos legendarios W16 y F12 siguen siendo legendarios).
const ENGINE_TIER = {
  'V16': 6, 'Rotativo 3': 6, 'Turbina': 6,
  'H16': 5, 'W16': 5, 'F12': 5,
  'V11': 4, 'H12': 4, 'VR12': 4, 'V12': 4, 'VR8': 4, 'V12 Invertido': 4,
  'H10': 3, 'H8': 3, 'Rotativo 2': 3, 'V7': 3,
  'In-Line 7': 2, 'H4': 2, 'H6': 2, 'VR4': 2, 'VR6': 2,
  'In-Line 6': 1,
};
export const ENGINES = ENGINE_ROWS.map(([name, power, , space, price], i) => {
  const classicTier = classicEngineTier(name, power);
  const tier = ENGINE_TIER[name] || (classicTier === 4 ? 5 : classicTier);
  return { id: 'e' + i, name, power, weight: CLASSIC_W[classicTier], space, price, tier, classicTier, cyl: parseInt((name.match(/\d+/) || ['0'])[0], 10) };
});

// Cilindrada ("Intake"): [nombre, espacio, multiplicador, rareza(1-4), precio]
const INTAKE_ROWS = [
  ['1.2L', 0.5, 1.05, 1, 1.0],
  ['1.9L', 0.5, 1.07, 1, 1.02],
  ['2.4L', 1, 1.1, 1, 1.03],
  ['2.6L', 1, 1.13, 1, 1.04],
  ['3.2L', 1, 1.2, 1, 1.05],
  ['3.8L', 1, 1.22, 1, 1.1],
  ['4.3L', 1, 1.25, 1, 1.15],
  ['4.6L', 1, 1.27, 2, 1.2],
  ['5.3L', 1, 1.3, 2, 1.25],
  ['5.7L', 1, 1.32, 2, 1.3],
  ['5.8L', 2, 1.33, 2, 1.35],
  ['6.1L', 2, 1.35, 2, 1.4],
  ['6.2L', 2, 1.36, 3, 1.45],
  ['6.7L', 2, 1.38, 3, 1.5],
  ['7.3L', 3, 1.4, 3, 1.55],
  ['7.4L', 3, 1.41, 3, 1.6],
  ['8.1L', 3, 1.47, 3, 1.65],
  ['8.3L', 4, 1.5, 4, 1.7],
  ['8.6L', 4, 1.6, 4, 1.75],
  ['9.1L', 4, 1.9, 4, 1.8],
  ['9.6L', 4, 2.2, 4, 1.85],
  ['10.1L', 4, 2.5, 4, 1.9],
  ['10.9L', 4, 2.7, 4, 1.95],
  ['11.4L', 4, 3.5, 4, 2.0],
  ['11.7L', 4, 4.0, 4, 2.05],
  ['12.3L', 4, 4.4, 4, 2.1],
];
// 8.3L-9.6L pasan a épicas; de 10.1L en adelante, legendarias.
export const INTAKES = INTAKE_ROWS.map(([name, space, mult, classicTier, price], i) => {
  const l = parseFloat(name);
  const tier = l >= 10 ? 5 : l >= 8.3 ? 4 : classicTier;
  return { id: 'i' + i, name, space, mult, tier, classicTier, price, weight: CLASSIC_W[classicTier] };
});

// Sobrealimentación: [nombre, espacio, multiplicador, rareza, aceleración, precio]
const TURBO_ROWS = [
  ['Atmosférico', 0, 1.0, 1, 1.0, 1.0],
  ['1 Turbo', 1, 1.25, 1, 1.2, 1.2],
  ['Biturbo', 2, 1.5, 2, 1.4, 1.4],
  ['Triturbo', 3, 1.75, 3, 1.6, 1.7],
  ['Cuatriturbo', 3, 2.0, 3, 1.8, 1.9],
  ['Compresor', 1, 1.65, 2, 1.75, 1.25],
  ['Doble compresor', 3, 2.5, 4, 2.5, 2.3],
];
// Cuatriturbo pasa a épico; el doble compresor, a legendario.
const TURBO_TIER = { 'Cuatriturbo': 4, 'Doble compresor': 5 };
export const TURBOS = TURBO_ROWS.map(([name, space, mult, classicTier, accel, price], i) => ({
  id: 't' + i, name, space, mult, tier: TURBO_TIER[name] || classicTier, classicTier, accel, price, weight: CLASSIC_W[classicTier],
  count: name === 'Atmosférico' ? 0 : name.includes('Compresor') || name.includes('compresor') ? (name.startsWith('Doble') ? 2 : 1) : [1, 2, 3, 4][['1 Turbo', 'Biturbo', 'Triturbo', 'Cuatriturbo'].indexOf(name)],
  supercharger: /ompresor/.test(name),
}));

// Tracción (hoja Extras): agarre y aceleración
export const TRACTIONS = [
  { id: 'TT', name: 'Trasera (TT)', grip: 1, accel: 2, tier: 1, weight: 0.5 },
  { id: 'TD', name: 'Delantera (TD)', grip: 2, accel: 1, tier: 1, weight: 0.5 },
  { id: 'AWD', name: 'Integral (AWD)', grip: 2, accel: 2, tier: 2, weight: 0.28 },
];

// Aerodinámica: más carga = más agarre, menos aceleración
export const AEROS = [
  { id: 'a25', name: 'Baja (0.25)', level: 0.25, grip: 1.5, accel: 1.35, tier: 1, weight: 0.5 },
  { id: 'a50', name: 'Media (0.50)', level: 0.5, grip: 1.75, accel: 1.25, tier: 1, weight: 0.5 },
  { id: 'a75', name: 'Alta (0.75)', level: 0.75, grip: 2.0, accel: 1.15, tier: 2, weight: 0.28 },
];

// Tipos de chasis (8). Espacio = hueco para motor + cilindrada + turbo.
// weight = probabilidad relativa al tirar el chasis (lo barato sale mucho más que lo exótico).
// perfW: peso del bloque "prestaciones" en la valoración del segmento (el resto pesa economía: fiabilidad, consumo y coste).
// decay: cuánto atractivo pierde el modelo por cada día en el mercado. hpCap: tope de CV útil del chasis
// (la potencia por encima del tope solo cuenta al 35%: rendimientos decrecientes).
export const CAR_TYPES = [
  { id: 'utilitario', name: 'Utilitario', space: 4, gripMult: 1.1, weightKg: 1050, tier: 1, weight: 0.30, baseCost: 6000, launchFactor: 14, demand: 14, priceRange: '3k–15k €', vmaxMult: 0.85, perfW: 0.30, decay: 0.975, hpCap: 220 },
  { id: 'furgoneta', name: 'Furgoneta', space: 5, gripMult: 0.9, weightKg: 1900, tier: 1, weight: 0.20, baseCost: 11000, launchFactor: 11, demand: 8, priceRange: '12k–40k €', vmaxMult: 0.75, perfW: 0.30, decay: 0.975, hpCap: 280 },
  { id: 'turismo', name: 'Turismo', space: 6, gripMult: 1.25, weightKg: 1350, tier: 1, weight: 0.30, baseCost: 9000, launchFactor: 12, demand: 12, priceRange: '5k–30k €', vmaxMult: 1.0, perfW: 0.42, decay: 0.970, hpCap: 350 },
  { id: 'suv', name: 'SUV', space: 7, gripMult: 1.05, weightKg: 1900, tier: 2, weight: 0.22, baseCost: 20000, launchFactor: 8, demand: 5, priceRange: '25k–90k €', vmaxMult: 0.88, perfW: 0.45, decay: 0.965, hpCap: 420 },
  { id: 'pickup', name: 'Pick-up', space: 8, gripMult: 1.0, weightKg: 2150, tier: 2, weight: 0.15, baseCost: 16000, launchFactor: 9, demand: 7, priceRange: '20k–60k €', vmaxMult: 0.82, perfW: 0.45, decay: 0.972, hpCap: 480 },
  { id: 'coupe', name: 'Coupé', space: 7, gripMult: 1.4, weightKg: 1350, tier: 3, weight: 0.15, baseCost: 38000, launchFactor: 6, demand: 3, priceRange: '40k–150k €', vmaxMult: 1.0, perfW: 0.60, decay: 0.955, hpCap: 560 },
  { id: 'deportivo', name: 'Deportivo', space: 9, gripMult: 1.7, weightKg: 1300, tier: 3, weight: 0.10, baseCost: 90000, launchFactor: 4, demand: 1.2, priceRange: '150k–400k €', vmaxMult: 1.08, perfW: 0.78, decay: 0.945, hpCap: 750 },
  { id: 'bolido', name: 'Bólido', space: 10, gripMult: 2.0, weightKg: 1250, tier: 4, weight: 0.05, baseCost: 240000, launchFactor: 2.5, demand: 0.35, priceRange: '600k € +', vmaxMult: 1.12, perfW: 0.88, decay: 0.935, hpCap: 950 },
];

// Rendimiento de fábrica: 60..130 (distribución triangular, centro 95)
export const PERF_MIN = 60;
export const PERF_MAX = 130;

export const BODY_COLORS = [
  '#d6402b', '#f28c28', '#f2c230', '#2f8f5b', '#1f6f8b', '#2b4c9b', '#e9e4d8', '#3a3f46',
  '#8a2be2', '#c2185b', '#6d8f3a', '#9aa5ad', '#0f9d9a', '#b5651d',
];

export const MODEL_NAMES = [
  'Kaiku', 'Urgull', 'Igeldo', 'Zurriola', 'Txingudi', 'Bidasoa', 'Aizkorri', 'Gorbea', 'Jaizkibel', 'Ulia',
  'Hondarribia', 'Getaria', 'Orio', 'Zarautz', 'Mendi', 'Haize', 'Ekaitz', 'Tximista', 'Itsaso', 'Olatu',
  'Larrun', 'Txindoki', 'Anboto', 'Ernio', 'Pagoeta', 'Arraitz', 'Gaztelu', 'Basoa', 'Elurra', 'Sugea',
];
// Mercado ya establecido: cada marca tiene su tamaño, prestigio, comunidad y estilo.
//  quality = tiradas que hace por coche (se queda con el mejor), models = gama objetivo,
//  focus = segmentos preferidos (vacío = generalista).
export const RIVALS = [
  { id: 'r1', name: 'Bilbo Autoak', color: '#4fa8ff', tag: 'Gigante del sector', prestige: 62, followers: 85000, models: 9, quality: 3, cash: 25000000, revenue7: 4200000, focus: [] },
  { id: 'r5', name: 'Lapurdi Auto', color: '#f2d23c', tag: 'Marca potente', prestige: 48, followers: 38000, models: 7, quality: 2, cash: 9000000, revenue7: 2100000, focus: ['suv', 'pickup', 'turismo'] },
  { id: 'r2', name: 'Iruña Motor', color: '#5fd38d', tag: 'Popular y modesta', prestige: 22, followers: 52000, models: 5, quality: 1, cash: 2500000, revenue7: 900000, focus: ['utilitario', 'turismo', 'furgoneta'] },
  { id: 'r3', name: 'Gasteiz Racing', color: '#e573ff', tag: 'Nicho deportivo', prestige: 36, followers: 14000, models: 4, quality: 2, cash: 3000000, revenue7: 700000, focus: ['coupe', 'deportivo', 'bolido'] },
  { id: 'r4', name: 'Donostia Dynamics', color: '#ff5f87', tag: 'Pequeña y desconocida', prestige: 12, followers: 1500, models: 3, quality: 1, cash: 600000, revenue7: 120000, focus: [] },
];
