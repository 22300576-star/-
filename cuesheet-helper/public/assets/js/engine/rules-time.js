import { josa } from './josa.js';
// Run Time 규칙
// 근거: OT '무대 큐시트 작성' - [Run Time] 00:00 ~ 00:00와 단시(n초) 모두 작성
//       2026 2차 큐시트 4행 - 총 13분(인트로 영상 2분 + 무대 11분), 무대 시간 11분 초과 절대 X
//       조명 가이드 '큐시트 작성 팁' - 영상의 재생 시간을 기준으로 시:분:초 기재
//       TFT 2차 피드백 - "단시 작성 및 각 무대당 Runtime 분리", "개사 내용 세부적인 Run Time에 맞춰서 분할"
import { STAGE_LIMIT_SEC, PLACEHOLDER } from './constants.js';
import { parseRunTime, fmtRunTime, fmtClock, fmtDurationKo } from './time.js';
import { addFinding, applyChange, applyPlaceholder, rowLabel, blockLabel } from './context.js';

const WHY_FORMAT = "OT 자료 '무대 큐시트 작성': Run Time은 '00:00 ~ 00:00'과 단시(n초)를 모두 작성";
const WHY_LIMIT = '2026 큐시트 안내: 총 13분(인트로 영상 2분 + 무대 11분), 무대 시간 11분 초과 절대 X';

export function contentRows(S) {
  return S.rows.filter((r) => r.kind === 'stage' || r.kind === 'video');
}

export function reparse(S) {
  for (const r of S.rows) r.rt = parseRunTime(r.c.runtime);
}

export function runTimeRules(ctx) {
  const { S, o } = ctx;
  reparse(S);
  const intro = S.rows.find((r) => r.kind === 'intro');
  const rows = contentRows(S);
  const timed = rows.filter((r) => r.rt.start != null);

  // 1) 기준 시점 판단: 인트로 영상 포함(0:00=인트로 시작) vs 인트로 이후(0:00=학부 영상 시작, 공시 방식)
  let shift = 0;
  if (timed.length) {
    const first = timed[0];
    const introRange = intro && intro.rt.start === 0 && intro.rt.end != null && intro.rt.end >= 60 && intro.rt.end <= 180;
    if (introRange || (first.rt.start >= 60 && first.rt.start <= 180 && first === rows[0])) {
      shift = introRange ? intro.rt.end : first.rt.start;
      if (first.rt.start < shift - 5) shift = 0; // 인트로 표기가 단순 라벨인 경우
    }
  }
  S.baseMode = shift ? 'with-intro' : 'after-intro';
  S.baseShift = shift;
  if (shift) {
    const fixId = 'time:base';
    const fin = addFinding(ctx, {
      id: 'time:base',
      cat: 'time',
      level: 'warn',
      title: 'Run Time 기준 시점 통일 (인트로 영상 이후 00:00)',
      msg: `Run Time이 인트로 영상 시작을 0:00으로 잡고 있습니다(첫 행이 ${fmtClock(shift)}에 시작). 운영팀은 학부 영상의 재생 시간을 보고 큐를 진행하므로, 인트로 영상이 끝나고 학부 영상이 시작되는 순간을 00:00으로 맞추는 것을 권장합니다(공시 큐시트 방식).`,
      why: "조명 가이드 '큐시트 작성 팁': 영상의 재생 시간을 기준으로 시:분:초를 기재",
      suggestion: `모든 Run Time에서 ${josa(fmtClock(shift), '을/를')} 빼서 00:00부터 시작하도록 맞춥니다.`,
      fixId,
    });
    if (fin && o.disabled.has(fixId)) {
      S.baseShift = 0;
    } else {
      for (const r of rows) {
        if (r.rt.start == null) continue;
        const s = Math.max(0, r.rt.start - shift);
        const e = r.rt.end != null ? Math.max(0, r.rt.end - shift) : null;
        if (e != null) applyChange(ctx, fixId, r, 'runtime', fmtRunTime(s, e), '인트로 영상 이후 00:00 기준으로 변환');
      }
      if (intro) applyChange(ctx, fixId, intro, 'runtime', `인트로 영상 ${fmtDurationKo(shift)}`, '인트로 영상은 TFT 영상: 길이만 표기');
      S.baseMode = 'after-intro(변환)';
      reparse(S);
    }
  }

  // 2) 순서대로 이어 붙이기: 단시만 적힌 행 채우기, 1초 끊김 보정, 무대별 0:00 재시작 보정
  let prevEnd = null;
  let unknownGap = false;
  const restartBlocks = new Set();
  const fmtFix = 'time:format';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rt = r.rt;
    if (rt.empty) {
      if (r.cont.runtime) continue;
      unknownGap = true;
      continue;
    }
    if (rt.durOnly) {
      if (prevEnd != null && !unknownGap) {
        const s = prevEnd;
        const e = prevEnd + rt.stated;
        addFinding(ctx, {
          id: `time:dur:${r.id}`,
          cat: 'time',
          level: 'warn',
          rowId: r.id,
          key: 'runtime',
          title: '시작~끝 시각 없이 길이만 적혀 있음',
          msg: `'${rt.raw}'처럼 길이만 적혀 있어 운영팀이 언제 시작하는지 알 수 없습니다. 이전 행이 끝나는 ${fmtClock(s)}부터 이어지는 것으로 계산했습니다.`,
          why: WHY_FORMAT,
          suggestion: fmtRunTime(s, e),
          fixId: `time:dur:${r.id}`,
        });
        applyChange(ctx, `time:dur:${r.id}`, r, 'runtime', fmtRunTime(s, e), '길이 → 시작~끝 시각');
        r.rt = parseRunTime(r.c.runtime);
      } else if (prevEnd == null && !unknownGap && i === 0) {
        addFinding(ctx, {
          id: `time:dur:${r.id}`,
          cat: 'time',
          level: 'warn',
          rowId: r.id,
          key: 'runtime',
          title: '시작~끝 시각 없이 길이만 적혀 있음',
          msg: `'${rt.raw}'처럼 길이만 적혀 있습니다. 첫 순서이므로 00:00부터 시작하는 것으로 계산했습니다.`,
          why: WHY_FORMAT,
          suggestion: fmtRunTime(0, rt.stated),
          fixId: `time:dur:${r.id}`,
        });
        applyChange(ctx, `time:dur:${r.id}`, r, 'runtime', fmtRunTime(0, rt.stated), '길이 → 시작~끝 시각');
        r.rt = parseRunTime(r.c.runtime);
      } else {
        addFinding(ctx, {
          id: `time:dur:${r.id}`,
          cat: 'time',
          level: 'error',
          rowId: r.id,
          key: 'runtime',
          title: '시작~끝 시각 없이 길이만 적혀 있음',
          msg: `'${rt.raw}'처럼 길이만 적혀 있고, 앞 순서의 끝 시각도 알 수 없어 전체 타임라인을 계산할 수 없습니다.`,
          why: WHY_FORMAT,
          suggestion: '앞 순서(특히 자체영상)의 Run Time을 먼저 채우면 자동으로 이어서 계산됩니다.',
        });
        continue;
      }
    }
    if (!r.rt.ok) {
      if (r.rt.start != null && r.rt.end != null && r.rt.end <= r.rt.start) {
        addFinding(ctx, {
          id: `time:order:${r.id}`,
          cat: 'time',
          level: 'error',
          rowId: r.id,
          key: 'runtime',
          title: '끝 시각이 시작 시각보다 빠름',
          msg: `'${r.rt.raw}' — 끝 시각이 시작 시각보다 빠르거나 같습니다.`,
          why: WHY_FORMAT,
        });
      }
      continue;
    }
    // 무대마다 00:00부터 다시 시작한 경우
    if (prevEnd != null && r.blockFirst && r.rt.start <= 5 && prevEnd - r.rt.start > 20) {
      const block = S.blocks[r.blockIndex];
      restartBlocks.add(block.index);
      if (!unknownGap) {
        const offset = prevEnd - r.rt.start;
        const fixId = `time:rebase:${block.index}`;
        addFinding(ctx, {
          id: fixId,
          cat: 'time',
          level: 'error',
          rowId: r.id,
          key: 'runtime',
          title: '무대마다 Run Time이 00:00부터 다시 시작함',
          msg: `${blockLabel(block)}의 Run Time이 다시 ${fmtClock(r.rt.start)}부터 시작합니다. 운영팀은 학부 전체 영상의 재생 시간 하나로 큐를 보므로 전체 타임라인으로 이어서 적어야 합니다. 앞 순서가 끝나는 ${fmtClock(prevEnd)}부터 이어지도록 ${fmtClock(offset)}만큼 밀었습니다.`,
          why: WHY_FORMAT,
          fixId,
        });
        for (const br of block.rows) {
          if (br.rt && br.rt.ok) applyChange(ctx, fixId, br, 'runtime', fmtRunTime(br.rt.start + offset, br.rt.end + offset), '전체 타임라인으로 변환');
        }
        for (const br of block.rows) br.rt = parseRunTime(br.c.runtime);
      } else {
        addFinding(ctx, {
          id: `time:rebase:${block.index}`,
          cat: 'time',
          level: 'error',
          rowId: r.id,
          key: 'runtime',
          title: '무대마다 Run Time이 00:00부터 다시 시작함',
          msg: `${blockLabel(block)}의 Run Time이 다시 00:00부터 시작합니다. 앞의 영상 행에 Run Time이 없어 전체 타임라인으로 바꿀 수 없습니다. 영상 행에 길이(예: 1분 30초)를 입력하면 자동으로 이어서 계산됩니다.`,
          why: WHY_FORMAT,
        });
      }
    }
    // 1초 끊김(0:17 → 0:18)
    if (prevEnd != null && !unknownGap && r.rt.start - prevEnd === 1 && r.rt.end > prevEnd) {
      applyChange(ctx, 'time:gap1', r, 'runtime', fmtRunTime(prevEnd, r.rt.end), '앞 행 끝 시각과 1초 끊김 보정');
      r.rt = parseRunTime(r.c.runtime);
    }
    // 표기 통일 + 단시 계산 오류
    const canon = fmtRunTime(r.rt.start, r.rt.end);
    if (r.rt.stated != null && r.rt.stated !== r.rt.end - r.rt.start) {
      const fixId = `time:dur-mismatch:${r.id}`;
      addFinding(ctx, {
        id: fixId,
        cat: 'time',
        level: 'warn',
        rowId: r.id,
        key: 'runtime',
        title: '단시(n초) 계산이 맞지 않음',
        msg: `'${r.rt.raw}' — 시작~끝은 ${r.rt.end - r.rt.start}초인데 ${r.rt.stated}초로 적혀 있습니다.`,
        why: WHY_FORMAT,
        suggestion: canon,
        fixId,
      });
      applyChange(ctx, fixId, r, 'runtime', canon, '단시 재계산');
    } else if (r.c.runtime !== canon) {
      applyChange(ctx, fmtFix, r, 'runtime', canon, 'Run Time 표기 통일');
    }
    if (r.rt.uncertain) {
      addFinding(ctx, {
        id: `time:uncertain:${r.id}`,
        cat: 'time',
        level: 'warn',
        rowId: r.id,
        key: 'runtime',
        title: '정확하지 않은 시간(±, 약)',
        msg: `'${r.rt.raw}' — 영상·음원 길이가 확정되면 정확한 초 단위로 적어주세요. 조명·음향 큐가 모두 이 시간을 기준으로 움직입니다.`,
        why: WHY_FORMAT,
      });
    }
    r.rt = parseRunTime(r.c.runtime);
    prevEnd = r.rt.end;
    unknownGap = false;
  }

  // 묶음 수정 발견 사항
  const gapFix = ctx.fixes.get('time:gap1');
  if (gapFix && gapFix.cells.length) {
    addFinding(ctx, {
      id: 'time:gap1',
      cat: 'time',
      level: 'info',
      title: `앞 행과 1초씩 끊긴 Run Time ${gapFix.cells.length}곳 보정`,
      msg: "'0:00-0:17' 다음 행을 '0:18'부터 적으면 1초가 비게 됩니다. 앞 행이 끝나는 시각에서 바로 이어지도록 맞췄습니다.",
      why: WHY_FORMAT,
      fixId: 'time:gap1',
      examples: gapFix.cells.slice(0, 4).map((c) => `${c.before} → ${c.after}`),
    });
  }
  const fmt = ctx.fixes.get(fmtFix);
  if (fmt && fmt.cells.length) {
    addFinding(ctx, {
      id: fmtFix,
      cat: 'time',
      level: 'info',
      title: `Run Time 표기 통일 ${fmt.cells.length}곳`,
      msg: "작성 예시와 같은 '00:00 ~ 00:04 (4초)' 형식(시작 ~ 끝 + 단시)으로 맞췄습니다.",
      why: WHY_FORMAT,
      fixId: fmtFix,
      examples: fmt.cells.slice(0, 4).map((c) => `${c.before.replace(/\n/g, ' ')} → ${c.after}`),
    });
  }

  // 3) 빠진 Run Time / 겹침 / 공백 / 단시 미분할
  reparse(S);
  let last = null;
  for (const b of S.blocks) {
    if (b.kind !== 'stage' && b.kind !== 'video') continue;
    const timedRows = b.rows.filter((r) => r.rt.ok);
    const untimed = b.rows.filter((r) => !r.rt.ok && !r.cont.runtime);
    if (!timedRows.length) {
      addFinding(ctx, {
        id: `time:missing:${b.index}`,
        cat: 'time',
        level: 'error',
        rowId: b.rows[0].id,
        key: 'runtime',
        title: 'Run Time 없음',
        msg: `${blockLabel(b)}에 Run Time이 없습니다. 영상도 '00:00 ~ 01:00 (60초)'처럼 시작·끝 시각과 단시를 모두 적어야 운영팀이 다음 큐를 준비할 수 있습니다.`,
        why: WHY_FORMAT,
      });
      for (const r of untimed) if (!r.c.runtime) applyPlaceholder(ctx, 'fill:placeholder', r, 'runtime', PLACEHOLDER, 'Run Time 작성 필요');
      continue;
    }
    if (b.kind === 'stage' && b.rows.length >= 2 && untimed.length) {
      addFinding(ctx, {
        id: `time:split:${b.index}`,
        cat: 'time',
        level: 'error',
        rowId: untimed[0].id,
        key: 'runtime',
        title: '단시가 나뉘지 않은 행이 있음',
        msg: `${blockLabel(b)}의 ${untimed.length}개 행에 Run Time이 없습니다. 가사 줄·동작·조명이 바뀌는 지점마다 '00:00 ~ 00:00 (n초)'로 나눠 적어야 합니다.`,
        why: "TFT 2차 피드백: '단시 작성 및 각 무대당 Runtime 분리'",
      });
      for (const r of untimed) if (!r.c.runtime) applyPlaceholder(ctx, 'fill:placeholder', r, 'runtime', PLACEHOLDER, '단시 작성 필요');
    }
    if (b.kind === 'stage' && b.rows.length === 1) {
      const r = b.rows[0];
      const dur = r.rt.end - r.rt.start;
      const lyricLines = r.c.lyrics.split('\n').filter((l) => l.trim()).length;
      if (dur >= 40 || (dur >= 25 && lyricLines >= 4)) {
        addFinding(ctx, {
          id: `time:split1:${b.index}`,
          cat: 'time',
          level: 'error',
          rowId: r.id,
          key: 'runtime',
          title: '한 곡을 한 행으로만 작성함',
          msg: `${josa(`${blockLabel(b)}(${dur}초)`, '이/가')} 한 행에 들어 있습니다. 가사 영상 슬라이드·대형 변화·조명 전환이 바뀌는 지점마다 행을 나누고 각각 Run Time과 단시를 적어주세요.`,
          why: "TFT 2차 피드백: '개사 내용 세부적인 Run Time에 맞춰서 분할 필요'",
        });
      }
    }
    for (const r of timedRows) {
      if (last) {
        const gap = r.rt.start - last.rt.end;
        if (gap > 1) {
          addFinding(ctx, {
            id: `time:gap:${r.id}`,
            cat: 'time',
            level: 'warn',
            rowId: r.id,
            key: 'runtime',
            title: `${gap}초 빈 구간`,
            msg: `${josa(rowLabel(S, last), '이/가')} ${fmtClock(last.rt.end)}에 끝나고 다음 행은 ${fmtClock(r.rt.start)}에 시작합니다. 그 사이에 무엇이 진행되는지 행을 추가하거나 시간을 이어지게 고쳐주세요.`,
            why: WHY_FORMAT,
          });
        } else if (gap < 0 && !(r.blockFirst && restartBlocks.has(r.blockIndex))) {
          addFinding(ctx, {
            id: `time:overlap:${r.id}`,
            cat: 'time',
            level: 'error',
            rowId: r.id,
            key: 'runtime',
            title: `${-gap}초 겹침`,
            msg: `${josa(rowLabel(S, last), '은/는')} ${fmtClock(last.rt.end)}에 끝나는데 다음 행이 ${fmtClock(r.rt.start)}에 시작해 시간이 겹칩니다.`,
            why: WHY_FORMAT,
          });
        }
      }
      last = r;
    }
  }

  // 4) 총 무대 시간 11분
  const ends = contentRows(S).filter((r) => r.rt.ok).map((r) => r.rt.end);
  const starts = contentRows(S).filter((r) => r.rt.ok).map((r) => r.rt.start);
  const total = ends.length ? Math.max(...ends) - (S.baseMode === 'with-intro' ? S.baseShift : 0) : 0;
  S.totalSec = total;
  S.firstStart = starts.length ? Math.min(...starts) : 0;
  if (total > STAGE_LIMIT_SEC) {
    addFinding(ctx, {
      id: 'time:limit',
      cat: 'time',
      level: 'error',
      title: `무대 시간 ${fmtDurationKo(total)} — 11분 초과`,
      msg: `인트로 영상을 제외한 학부 순서가 ${fmtDurationKo(total)}입니다. ${josa(fmtDurationKo(total - STAGE_LIMIT_SEC), '을/를')} 줄여야 합니다.`,
      why: WHY_LIMIT,
    });
  } else if (total > 0) {
    addFinding(ctx, {
      id: 'time:total',
      cat: 'time',
      level: 'info',
      title: `무대 시간 ${fmtDurationKo(total)} / 11분`,
      msg: `인트로 영상을 제외한 학부 순서 길이입니다. 남은 여유: ${fmtDurationKo(STAGE_LIMIT_SEC - total)}.`,
      why: WHY_LIMIT,
    });
  }
}
