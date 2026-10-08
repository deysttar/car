// Datos extraídos de Motores.xlsx (hojas "Engine" y "Extras").
// Correcciones aplicadas al Excel original:
//  - Valores que Excel convirtió en fechas (p. ej. F4 "3.2" -> 3-feb) se han restaurado a número.
//  - Rareza 0.7 (F12, Turbine) se interpreta como 0.07 (legendario), en línea con 0.5 / 0.28 / 0.15.
//  - W16 pasa de 0.28 a 0.07: es el motor más fuerte y no tenía sentido que fuera "poco común".
//  - Cilindradas sin rareza/precio (1.2L-2.6L y 10.9L-12.3L) se completan por interpolación.

// Rareza: probabilidad relativa. Niveles 1..4 de cilindrada/turbo usan el mismo peso.
export const RARITY = {
  1: { key: 1, name: 'Común', weight: 0.5, color: '#b9b4a8' },
  2: { key: 2, name: 'Poco común', weight: 0.28, color: '#5fd38d' },
  3: { key: 3, name: 'Raro', weight: 0.15, color: '#4fa8ff' },
  4: { key: 4, name: 'Legendario', weight: 0.07, color: '#ffb627' },
};
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
const engineTier = (name, p) => (name === 'Turbina' ? 4 : p >= 4 ? 4 : p >= 3 ? 3 : p >= 2 ? 2 : 1);
export const ENGINES = ENGINE_ROWS.map(([name, power, , space, price], i) => {
  const tier = engineTier(name, power);
  return { id: 'e' + i, name, power, weight: RARITY[tier].weight, space, price, tier, cyl: parseInt((name.match(/\d+/) || ['0'])[0], 10) };
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
export const INTAKES = INTAKE_ROWS.map(([name, space, mult, tier, price], i) => ({
  id: 'i' + i, name, space, mult, tier, price, weight: RARITY[tier].weight,
}));

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
export const TURBOS = TURBO_ROWS.map(([name, space, mult, tier, accel, price], i) => ({
  id: 't' + i, name, space, mult, tier, accel, price, weight: RARITY[tier].weight,
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
export const CAR_TYPES = [
  { id: 'utilitario', name: 'Utilitario', space: 4, gripMult: 1.1, weightKg: 1050, tier: 1, weight: 0.30, baseCost: 6000, launchFactor: 14, demand: 14, priceRange: '3k–15k €', vmaxMult: 0.85 },
  { id: 'furgoneta', name: 'Furgoneta', space: 5, gripMult: 0.9, weightKg: 1900, tier: 1, weight: 0.20, baseCost: 11000, launchFactor: 11, demand: 8, priceRange: '12k–40k €', vmaxMult: 0.75 },
  { id: 'turismo', name: 'Turismo', space: 6, gripMult: 1.25, weightKg: 1350, tier: 1, weight: 0.30, baseCost: 9000, launchFactor: 12, demand: 12, priceRange: '5k–30k €', vmaxMult: 1.0 },
  { id: 'suv', name: 'SUV', space: 7, gripMult: 1.05, weightKg: 1900, tier: 2, weight: 0.22, baseCost: 20000, launchFactor: 8, demand: 5, priceRange: '25k–90k €', vmaxMult: 0.88 },
  { id: 'pickup', name: 'Pick-up', space: 8, gripMult: 1.0, weightKg: 2150, tier: 2, weight: 0.15, baseCost: 16000, launchFactor: 9, demand: 7, priceRange: '20k–60k €', vmaxMult: 0.82 },
  { id: 'coupe', name: 'Coupé', space: 7, gripMult: 1.4, weightKg: 1350, tier: 3, weight: 0.15, baseCost: 38000, launchFactor: 6, demand: 3, priceRange: '40k–150k €', vmaxMult: 1.0 },
  { id: 'deportivo', name: 'Deportivo', space: 9, gripMult: 1.7, weightKg: 1300, tier: 3, weight: 0.10, baseCost: 90000, launchFactor: 4, demand: 1.2, priceRange: '150k–400k €', vmaxMult: 1.08 },
  { id: 'bolido', name: 'Bólido', space: 10, gripMult: 2.0, weightKg: 1250, tier: 4, weight: 0.05, baseCost: 240000, launchFactor: 2.5, demand: 0.35, priceRange: '600k € +', vmaxMult: 1.12 },
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
export const RIVALS = [
  { id: 'r1', name: 'Bilbo Autoak', color: '#4fa8ff' },
  { id: 'r2', name: 'Iruña Motor', color: '#5fd38d' },
  { id: 'r3', name: 'Gasteiz Racing', color: '#e573ff' },
];
