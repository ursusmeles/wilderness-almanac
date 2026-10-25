// Saved campaign presentation; these presets never change map replay data.
export const TIMES_OF_DAY = ['dawn', 'day', 'dusk', 'night'];
export const timeOfDay = (value) => (TIMES_OF_DAY.includes(value) ? value : 'day');
export const nextTimeOfDay = (value) =>
  TIMES_OF_DAY[(TIMES_OF_DAY.indexOf(timeOfDay(value)) + 1) % TIMES_OF_DAY.length];
const dayWind = { strength: 1.2, gustPeriod: 18 };
const ordinaryWind = { strength: 1, gustPeriod: 24 };
export const windForTimeOfDay = (value) => (timeOfDay(value) === 'day' ? dayWind : ordinaryWind);

export const DAYLIGHT = {
  day: {
    sky: '#ffffff',
    ground: '#777777',
    ambient: 1.8,
    sun: '#ffffff',
    intensity: 2.6,
    position: [-15, 30, -18],
    shadowExtent: 24,
    shadowFar: 90,
    shadowOpacity: 0.17,
    glow: 0,
  },
  dawn: {
    sky: '#ffe2ee',
    ground: '#97788e',
    ambient: 2.05,
    sun: '#ffd2df',
    intensity: 3.0,
    position: [34.64, 14, -20],
    shadowExtent: 30,
    shadowFar: 130,
    shadowOpacity: 0.2,
    glow: 0,
  },
  dusk: {
    sky: '#e8b4a5',
    ground: '#54334d',
    ambient: 0.95,
    sun: '#ff984c',
    intensity: 1.75,
    position: [-37.4, 8, 21.6],
    shadowExtent: 30,
    shadowFar: 130,
    shadowOpacity: 0.25,
    glow: 0.7,
  },
  night: {
    sky: '#8199dc',
    ground: '#101a42',
    ambient: 0.65,
    sun: '#829fff',
    intensity: 0.45,
    position: [-12, 28, -22],
    shadowExtent: 24,
    shadowFar: 90,
    shadowOpacity: 0.08,
    glow: 1,
  },
};
