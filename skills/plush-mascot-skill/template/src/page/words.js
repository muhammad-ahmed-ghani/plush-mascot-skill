// The page's copy (src/page/copy.js) as the scripts use it: say(line) fills in the character's name, product and tagline from
// mascot.config.json, plus any placeholders the caller passes ({status}, {quality}).
import config from '../config.js';
import { COPY, fill } from './copy.js';

const CHARACTER = { name: config.character.name, product: config.character.product, tagline: config.character.tagline };

export { COPY };
export const say = (line, vars = {}) => fill(line, { ...CHARACTER, ...vars });
