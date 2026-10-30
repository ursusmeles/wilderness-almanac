import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { hexName } from '../src/application/hex-description.js';
import { palettes } from '../src/palette.js';

// Prepare the fixed scene in Node, keeping the world generator out of the embed.
export function heroScenePlugin() {
  const id = '\0virtual:hero-scene';
  return {
    name: 'wilderness-hero-scene',
    resolveId(source) {
      if (source === 'virtual:hero-scene') return id;
    },
    load(source) {
      if (source !== id) return;
      const world = generateWorld('heliotest');
      const layout = prepareMap(world, generateDressing(world, 0));
      return `export default ${JSON.stringify({
        layout,
        palette: palettes.thronefall,
        hexes: layout.map((cell) => ({ key: cell.key, label: hexName(cell) })),
      })};`;
    },
  };
}
