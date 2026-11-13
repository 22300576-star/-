// 선 아이콘 (24×24, currentColor)
const P = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.3c2.2.2 3.9 1.8 4.6 4.7"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  sliders: '<path d="M5 4v6M5 14v6M12 4v3M12 11v9M19 4v9M19 17v3"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="9" r="2"/><circle cx="19" cy="15" r="2"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  bulb: '<path d="M9 18h6M10 21h4M8.5 14.5A6 6 0 1 1 15.5 14.5c-.9.7-1.5 1.6-1.5 2.5h-4c0-.9-.6-1.8-1.5-2.5z"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  grid: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
};

export function icon(name, size = 24) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// HANFLIX 워드마크 — 글꼴에 의존하지 않도록 도형으로 그림(가장자리 글자가 길어지는 곡선 효과)
const LETTERS = [
  { w: 50, d: 'M0 0h14v42h22V0h14v100H36V56H14v44H0z' },
  { w: 52, d: 'M0 100L18 0h16l18 100H38l-3.5-20h-17L14 100zM20 66h12L26 26z' },
  { w: 50, d: 'M0 100V0h14l22 62V0h14v100H36L14 38v62z' },
  { w: 40, d: 'M0 100V0h40v14H14v28h20v14H14v44z' },
  { w: 38, d: 'M0 0h14v86h24v14H0z' },
  { w: 14, d: 'M0 0h14v100H0z' },
  { w: 52, d: 'M0 0h15l11 36L37 0h15L34 50l18 50H37L26 64 15 100H0l18-50z' },
];
const SCALE = [1.17, 1.08, 1.03, 1, 1.03, 1.08, 1.17];

export function wordmark(cls = 'wm') {
  let x = 0;
  const parts = LETTERS.map((L, i) => {
    const g = `<path transform="translate(${x} 50) scale(1 ${SCALE[i]}) translate(0 -50)" d="${L.d}"/>`;
    x += L.w + 7;
    return g;
  });
  const w = x - 7;
  return `<svg class="${cls}" viewBox="0 -12 ${w} 124" role="img" aria-label="HANFLIX"><g fill="#0060d1" fill-rule="evenodd">${parts.join('')}</g></svg>`;
}
