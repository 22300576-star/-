// 첨부 파일에서 AI에게 보낼 내용을 꺼낸다 (브라우저와 Node 공용)
//  - 워드(.docx) · 한글(.hwpx) · 파워포인트(.pptx): zip 안의 XML에서 글자만 (브라우저 내장 압축 해제 사용)
//  - 텍스트 · CSV · 마크다운: 그대로
//  - PDF · 이미지: base64로 보내 AI가 직접 읽음 (한글 .hwp · 예전 .doc는 PDF로 저장해서 올리기)

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// zip에서 원하는 파일만 꺼냄 → Map(이름 → Uint8Array)
export async function unzip(buf, want = () => true) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('문서 파일을 열지 못했습니다(압축 형식이 아님).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map();
  for (let n = 0; n < count && p + 46 <= u8.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(start, start + csize);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflateRaw(data));
  }
  return out;
}

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export const decodeXml = (s) =>
  String(s).replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] || m));

// 문단 태그(<w:p>, <hp:p>, <a:p>)마다 글자 태그(<w:t>, <hp:t>, <a:t>)를 이어 붙인다
export function xmlParagraphs(xml, ns) {
  const src = String(xml)
    .replace(new RegExp(`<${ns}:tab\\b[^>]*/>`, 'g'), `<${ns}:t>\t</${ns}:t>`)
    .replace(new RegExp(`<${ns}:(?:br|lineBreak)\\b[^>]*/>`, 'g'), `<${ns}:t>\n</${ns}:t>`);
  const lines = [];
  const pRe = new RegExp(`<${ns}:p[\\s>][\\s\\S]*?</${ns}:p>`, 'g');
  const tRe = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([\\s\\S]*?)</${ns}:t>`, 'g');
  for (const m of src.match(pRe) || []) {
    let t = '';
    for (const x of m.matchAll(tRe)) t += decodeXml(x[1].replace(/<[^>]+>/g, ''));
    lines.push(t);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const byNumber = (a, b) => Number((a.match(/(\d+)\.xml$/) || [0, 0])[1]) - Number((b.match(/(\d+)\.xml$/) || [0, 0])[1]);
const dec = (u8) => new TextDecoder().decode(u8);

export async function docxText(buf) {
  const files = await unzip(buf, (n) => n === 'word/document.xml');
  const xml = files.get('word/document.xml');
  if (!xml) throw new Error('워드 문서 내용을 찾지 못했습니다.');
  return xmlParagraphs(dec(xml), 'w');
}
export async function hwpxText(buf) {
  const files = await unzip(buf, (n) => /^Contents\/section\d+\.xml$/.test(n));
  if (!files.size) throw new Error('한글(hwpx) 문서 내용을 찾지 못했습니다.');
  return [...files.keys()].sort(byNumber).map((k) => xmlParagraphs(dec(files.get(k)), 'hp')).join('\n\n');
}
export async function pptxText(buf) {
  const files = await unzip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  if (!files.size) throw new Error('파워포인트 슬라이드 내용을 찾지 못했습니다.');
  return [...files.keys()]
    .sort(byNumber)
    .map((k, i) => `[슬라이드 ${i + 1}]\n${xmlParagraphs(dec(files.get(k)), 'a')}`)
    .join('\n\n');
}

// ArrayBuffer → base64 (큰 파일도 나눠서)
export function toBase64(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export const TEXT_EXT = ['txt', 'md', 'csv', 'tsv', 'json', 'text', 'log'];
export const OLD_EXT = { hwp: '한글(.hwp)', doc: '워드 97-2003(.doc)', ppt: '파워포인트 97-2003(.ppt)', xls: '엑셀 97-2003(.xls)' };
export const extOf = (name) => (String(name).match(/\.([a-z0-9]+)$/i) || [0, ''])[1].toLowerCase();
