import { HOST_ITEM_RE, INTRO_ITEM_RE, VIDEO_ITEM_RE, STAGE_ITEM_RE } from './vocab.js';

// 블록 종류: host(학부 소개·투표) / intro(학부 인트로 영상) / video(자체영상) / stage(무대)
export function classifyItem(item, rows = []) {
  const t = (item || '').replace(/\s+/g, ' ').trim();
  if (t) {
    if (HOST_ITEM_RE.test(t) && !/^무대/.test(t)) return 'host';
    if (INTRO_ITEM_RE.test(t) && !/^무대/.test(t)) return 'intro';
    if (/^무대/.test(t) || /트랜지션|트렌지션|transition/i.test(t)) return 'stage';
    if (VIDEO_ITEM_RE.test(t)) return 'video';
    if (STAGE_ITEM_RE.test(t)) return 'stage';
    return 'stage';
  }
  // 항목명이 없으면 내용으로 추정
  const screen = rows.map((r) => r.c.screen).join(' ');
  const lyrics = rows.map((r) => r.c.lyrics).join('');
  if (/영상/.test(screen) && !lyrics.trim()) return 'video';
  return 'stage';
}
