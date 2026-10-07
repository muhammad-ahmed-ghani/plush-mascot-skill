// Small DOM helpers: headline words that can slide up out of a mask, and the stitched frames of buttons.

const NS = 'http://www.w3.org/2000/svg';

/**
 * Wrap every word of a headline in a mask (.wd) and an inner slider (.wd__in) whose delay follows its index (--i), keeping the
 * spaces between them so the text still reads as one line to a screen reader and wraps like normal text.  Returns the word count.
 */
export function splitWords(root) {
  let i = 0;
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.append(part); continue; }
          const mask = document.createElement('span'), slide = document.createElement('span');
          mask.className = 'wd'; slide.className = 'wd__in';
          slide.textContent = part;
          mask.style.setProperty('--i', String(i++));
          mask.append(slide);
          frag.append(mask);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) walk(child);
    }
  };
  walk(root);
  return i;
}

/** Give buttons and tags their running-stitch frame (an SVG rectangle the CSS draws as dashes). */
export function addStitches(root = document) {
  for (const el of root.querySelectorAll('.btn:not(.btn--text), .tag, .states button')) {
    if (el.querySelector(':scope > .stitch')) continue;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'stitch');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const rect = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x: 1.5, y: 1.5, width: '100%', height: '100%', rx: 12 })) rect.setAttribute(k, v);      // (plain attributes for browsers that ignore the css geometry)
    svg.append(rect);
    el.prepend(svg);
  }
}
