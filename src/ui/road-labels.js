// Clockwise compass directions for the fixed map view. Keep the saved side
// indices unchanged: at (4, -2), (4, -3) is north (side 4).
export const ROAD_DIRECTIONS = [
  { side: 4, label: 'N', name: 'North' },
  { side: 5, label: 'NE', name: 'Northeast' },
  { side: 0, label: 'SE', name: 'Southeast' },
  { side: 1, label: 'S', name: 'South' },
  { side: 2, label: 'SW', name: 'Southwest' },
  { side: 3, label: 'NW', name: 'Northwest' },
];

export const roadExitLabels = (mask = 0) =>
  ROAD_DIRECTIONS.filter(({ side }) => mask & (1 << side)).map(({ label }) => label);
