// AI 큐시트 작성에 붙이는 파일 읽기 (브라우저)
//  - 텍스트 · CSV · 마크다운 → 글자 그대로
//  - 워드(.docx) · 한글(.hwpx) · 파워포인트(.pptx) → 문서 안 글자만 꺼냄
//  - 엑셀(.xlsx) → 탭마다 표를 글자로 (예전 큐시트, 가사표, 인원표 등)
//  - PDF · 이미지(콘티, 동선도, 무대 그림) → 그대로 보내 AI가 직접 읽음 (큰 이미지는 줄여서)
//  - 한글(.hwp) · 예전 오피스(.doc/.ppt/.xls) → 읽을 수 없어 PDF나 새 형식으로 저장하도록 안내
import { docxText, hwpxText, pptxText, toBase64, TEXT_EXT, OLD_EXT, extOf } from './doctext.js';
import { readWorkbook } from './importers.js';

export const MAX_FILES = 8;
export const MAX_BINARY = 3_500_000; // PDF · 이미지 합계 (서버 한도 3.6MB 안쪽)
export const MAX_TEXT = 60_000; // 파일 하나에서 보내는 글자 수
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const XLSX_EXT = ['xlsx', 'xlsm'];

export const ACCEPT = [
  ...TEXT_EXT.map((e) => `.${e}`),
  '.docx',
  '.hwpx',
  '.pptx',
  ...XLSX_EXT.map((e) => `.${e}`),
  '.pdf',
  ...IMAGE_EXT.map((e) => `.${e}`),
  ...Object.keys(OLD_EXT).map((e) => `.${e}`),
].join(',');

const LABEL = { docx: '워드', doc: '워드', hwpx: '한글', hwp: '한글', pptx: '파워포인트', ppt: '파워포인트', xlsx: '엑셀', xlsm: '엑셀', xls: '엑셀', pdf: 'PDF', csv: 'CSV', tsv: '표(TSV)', md: '텍스트', json: '텍스트' };
export const labelOf = (ext) => LABEL[ext] || (IMAGE_EXT.includes(ext) ? '이미지' : TEXT_EXT.includes(ext) ? '텍스트' : '파일');
export const labelFor = (name) => labelOf(extOf(name));

export const sizeText = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1000))}KB`);

// 엑셀 → 글자: 탭마다 '[탭 이름]' + 행(칸은 ' | '로)
export function sheetsText(sheets) {
  const out = [];
  for (const s of sheets) {
    const rows = s.cells.map((r) => r.map((v) => String(v ?? '').replace(/\s*\n\s*/g, ' / ').trim())).filter((r) => r.some(Boolean));
    if (!rows.length) continue;
    const width = Math.max(...rows.map((r) => r.reduce((n, v, i) => (v ? i + 1 : n), 0)));
    out.push(`[탭: ${s.name}]`, ...rows.map((r) => r.slice(0, width).join(' | ')));
  }
  return out.join('\n');
}

function clipText(t) {
  const s = String(t || '').replace(/\r\n?/g, '\n').trim();
  return s.length > MAX_TEXT ? { text: `${s.slice(0, MAX_TEXT)}\n…(이하 생략)`, cut: true } : { text: s, cut: false };
}

// 큰 이미지는 긴 변 2000px · JPEG로 줄여 보낸다 (글자가 있는 콘티도 읽을 수 있는 크기)
async function shrinkImage(file, max = 2000) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('이미지를 열지 못했습니다.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('이미지를 줄이지 못했습니다.');
    return { data: toBase64(await blob.arrayBuffer()), mime: 'image/jpeg', bytes: blob.size, note: scale < 1 ? `${w}×${h}로 줄임` : '' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 파일 하나 읽기
 * @returns {Promise<{ name, ext, label, kind: 'text'|'pdf'|'image', size, text?, data?, mime?, bytes, chars, note }>}
 */
export async function readAttachment(file, { ExcelJS } = {}) {
  const name = file.name || '첨부 파일';
  const ext = extOf(name);
  const base = { name, ext, label: labelOf(ext), size: file.size, note: '' };
  if (OLD_EXT[ext]) throw new Error(`${OLD_EXT[ext]} 파일은 바로 읽을 수 없습니다. 'PDF로 저장'하거나 새 형식(.docx · .hwpx · .pptx · .xlsx)으로 저장해서 올려 주세요.`);
  const asText = (t, note = '') => {
    const { text, cut } = clipText(t);
    if (!text) throw new Error('글자를 찾지 못했습니다. 스캔한 문서라면 PDF나 이미지로 올려 주세요.');
    return { ...base, kind: 'text', text, chars: text.length, bytes: 0, note: [note, cut ? `앞 ${MAX_TEXT.toLocaleString()}자만` : ''].filter(Boolean).join(' · ') };
  };
  if (TEXT_EXT.includes(ext) || (!ext && /^text\//.test(file.type))) return asText(await file.text());
  if (ext === 'docx') return asText(await docxText(await file.arrayBuffer()));
  if (ext === 'hwpx') return asText(await hwpxText(await file.arrayBuffer()));
  if (ext === 'pptx') return asText(await pptxText(await file.arrayBuffer()));
  if (XLSX_EXT.includes(ext)) {
    if (!ExcelJS) throw new Error('엑셀 모듈을 불러오는 중입니다. 잠시 후 다시 올려 주세요.');
    const sheets = await readWorkbook(ExcelJS, await file.arrayBuffer());
    return asText(sheetsText(sheets), `탭 ${sheets.length}개`);
  }
  if (ext === 'pdf' || file.type === 'application/pdf') {
    if (file.size > MAX_BINARY) throw new Error(`PDF가 너무 큽니다(${sizeText(file.size)}). 필요한 쪽만 저장해 3.5MB 이하로 올려 주세요.`);
    return { ...base, kind: 'pdf', data: toBase64(await file.arrayBuffer()), mime: 'application/pdf', bytes: file.size, chars: 0 };
  }
  if (IMAGE_EXT.includes(ext) || /^image\//.test(file.type)) {
    const okType = /^image\/(png|jpeg|webp)$/.test(file.type);
    if (okType && file.size <= 1_200_000) {
      const img = await new Promise((resolve) => {
        const u = URL.createObjectURL(file);
        const i = new Image();
        i.onload = () => (URL.revokeObjectURL(u), resolve(i));
        i.onerror = () => (URL.revokeObjectURL(u), resolve(null));
        i.src = u;
      });
      if (img && Math.max(img.naturalWidth, img.naturalHeight) <= 2000) return { ...base, kind: 'image', data: toBase64(await file.arrayBuffer()), mime: file.type, bytes: file.size, chars: 0 };
    }
    return { ...base, kind: 'image', chars: 0, ...(await shrinkImage(file)) };
  }
  throw new Error('읽을 수 없는 파일 형식입니다. 텍스트 · 워드 · 한글(.hwpx) · PDF · 파워포인트 · 엑셀 · 이미지를 올려 주세요.');
}
