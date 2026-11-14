#!/usr/bin/env python3
"""Разбор записи экрана по кадрам: листы, кривая «до покоя», флаги gap/jump.

    python3 scripts/frames.py rec.mp4 --out /tmp/…/rec [--start 1.2 --end 2.4]
        [--crop X,Y,W,H] [--columns 8 --rows 4] [--points-width 402]

Методика — docs/IOS_RULES.md §3.2–3.3. Реализация своя: код Telegram (GPL) не
переносится (§3.3.3). Зависимости — только стандартная библиотека и ffmpeg/ffprobe.

Что делает:
- время каждого кадра берёт из `ffprobe` (`pts_time`, при `N/A` —
  `best_effort_timestamp_time`): у `ffmpeg` после повторённой метки время уезжает
  на секунды (§3.2.3). Число кадров ffprobe и ffmpeg обязано совпасть, иначе стоп;
- `--start/--end` (секунды по часам записи) применяются после склейки «кадр ↔ время»,
  кадры выбираются по номеру, не по времени ffmpeg;
- геометрия — в точках: масштаб K = ширина записи в px / `--points-width` (§3.2.4).
  `--crop` задаётся в точках. Кадры листов приводятся к точкам;
- по серому кадру шириной 160 px считает: `change` — средний модуль разности с
  предыдущим кадром (0…255), `to_final` — то же с последним кадром диапазона (покоем),
  `region` — рамка пикселей с разностью > 12 (в pt), `interval` — мс от предыдущего;
- флаги (§3.3.4) — подсказки, куда смотреть, а не вердикт:
  `gap` — интервал > 1,5× медианы интервалов менявшихся кадров при `change` ≥ 5 %
  максимума; `jump` — `change` > 1 и > 3× медианы соседей (±3 кадра, без самого);
- запись iPhone ≤ 30 к/с: по ней видна форма движения, но не рывки 120 Гц (§3.2.1),
  и `gap` на ней — часто просто потерянный кадр записи.

Выход в `--out`: `frames/NNNNN.png` (номер кадра в записи), `sheet-NN.png` (подпись
«#номер t=секунды +мс», помеченные — в красной рамке), `motion.png`, `frames.tsv`,
`summary.txt` (он же печатается).

Видео в git не класть, разбор — в scratchpad (§3.2.8).
"""

from __future__ import annotations

import argparse
import shutil
import statistics
import struct
import subprocess
import sys
import zlib
from dataclasses import dataclass, field
from pathlib import Path

GRAY_WIDTH = 160
STILL = 0.05  # change ниже — кадр не менялся
HOT_PIXEL = 12  # разность пикселя, попадающая в region
LABEL_HEIGHT = 22


class FramesError(Exception):
    pass


def call(args: list[str]) -> str:
    done = subprocess.run(args, capture_output=True, text=True)
    if done.returncode != 0:
        raise FramesError(f"{args[0]} завершился с кодом {done.returncode}:\n{done.stderr.strip()}")
    return done.stdout


# MARK: - Чтение записи


def stream_size(video: Path) -> tuple[int, int]:
    out = call([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "default=nw=1", str(video),
    ])
    values = dict(line.split("=", 1) for line in out.split() if "=" in line)
    return int(values["width"]), int(values["height"])


def frame_times(video: Path) -> list[float]:
    """Время каждого кадра по порядку — из ffprobe, а не из ffmpeg (§3.2.3)."""
    out = call([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "frame=pts_time,best_effort_timestamp_time", "-of", "csv=p=0", str(video),
    ])
    times: list[float] = []
    for line in out.splitlines():
        cells = [c.strip() for c in line.split(",") if c.strip()]
        if not cells:
            continue
        known = [c for c in cells if c != "N/A"]
        if not known:
            raise FramesError(f"у кадра {len(times)} нет ни pts_time, ни best_effort_timestamp_time")
        times.append(float(known[0]))
    if not times:
        raise FramesError("в записи нет кадров видео")
    return times


@dataclass
class Geometry:
    """Масштаб записи и область разбора: в px записи и в точках."""

    scale: float  # px записи на pt
    crop_px: tuple[int, int, int, int]  # x, y, w, h
    gray_height: int
    tile_width: int  # ширина кадра листа (pt, чётная)

    @property
    def crop_filter(self) -> str:
        x, y, w, h = self.crop_px
        return f"crop={w}:{h}:{x}:{y}"

    @property
    def width_pt(self) -> float:
        return self.crop_px[2] / self.scale

    @property
    def pt_per_gray(self) -> float:
        return self.width_pt / GRAY_WIDTH


def even(value: float) -> int:
    return max(2, int(round(value / 2)) * 2)


def make_geometry(size: tuple[int, int], points_width: float, crop_pt: str | None, tile_width: int | None) -> Geometry:
    width, height = size
    scale = width / points_width
    if crop_pt:
        try:
            x, y, w, h = (float(v) for v in crop_pt.split(","))
        except ValueError:
            raise FramesError("--crop ждёт X,Y,W,H в точках") from None
        x_px, y_px = max(0, round(x * scale)), max(0, round(y * scale))
        w_px = min(width - x_px, round(w * scale))
        h_px = min(height - y_px, round(h * scale))
        if w_px < 2 or h_px < 2:
            raise FramesError("--crop пуст или вне кадра")
        crop = (x_px, y_px, w_px, h_px)
    else:
        crop = (0, 0, width, height)
    gray_height = even(crop[3] * GRAY_WIDTH / crop[2])
    return Geometry(
        scale=scale,
        crop_px=crop,
        gray_height=gray_height,
        tile_width=even(tile_width if tile_width else crop[2] / scale),
    )


def read_gray(video: Path, geo: Geometry, first: int, last: int) -> tuple[int, list[bytes], bytes | None]:
    """Прогоняет всю запись в сером 160 px. Возвращает общее число кадров ffmpeg,
    кадры диапазона и кадр перед ним (для `change` первого кадра диапазона)."""
    frame_bytes = GRAY_WIDTH * geo.gray_height
    process = subprocess.Popen(
        [
            "ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-i", str(video),
            "-vf", f"{geo.crop_filter},scale={GRAY_WIDTH}:{geo.gray_height}:flags=area,format=gray",
            "-fps_mode", "passthrough", "-f", "rawvideo", "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert process.stdout is not None
    count = 0
    kept: list[bytes] = []
    before: bytes | None = None
    while True:
        chunk = process.stdout.read(frame_bytes)
        if not chunk:
            break
        if len(chunk) != frame_bytes:
            raise FramesError("ffmpeg отдал неполный кадр")
        if count == first - 1:
            before = chunk
        if first <= count <= last:
            kept.append(chunk)
        count += 1
    _, errors = process.communicate()
    if process.returncode != 0:
        raise FramesError(f"ffmpeg (серые кадры): {errors.decode(errors='replace').strip()}")
    return count, kept, before


# MARK: - Метрики


@dataclass
class Frame:
    index: int  # номер кадра в записи, с 0
    time: float
    interval_ms: float | None
    change: float = 0.0
    to_final: float = 0.0
    region: tuple[float, float, float, float] | None = None  # x, y, w, h в pt
    flags: list[str] = field(default_factory=list)


def mean_difference(a: bytes, b: bytes) -> float:
    return sum(abs(p - q) for p, q in zip(a, b)) / len(a)


def difference_with_region(a: bytes, b: bytes, width: int) -> tuple[float, tuple[int, int, int, int] | None]:
    """Средняя разность и рамка (x0, y0, x1, y1) пикселей с разностью > HOT_PIXEL."""
    total = 0
    left, right, top, bottom = width, -1, -1, -1
    for y in range(len(a) // width):
        start = y * width
        row = [abs(p - q) for p, q in zip(a[start:start + width], b[start:start + width])]
        total += sum(row)
        hot = [x for x, d in enumerate(row) if d > HOT_PIXEL]
        if hot:
            left, right = min(left, hot[0]), max(right, hot[-1])
            if top < 0:
                top = y
            bottom = y
    box = (left, top, right, bottom) if right >= 0 else None
    return total / len(a), box


def measure(frames: list[Frame], grays: list[bytes], before: bytes | None, geo: Geometry) -> None:
    final = grays[-1]
    k = geo.pt_per_gray
    for i, (frame, gray) in enumerate(zip(frames, grays)):
        previous = grays[i - 1] if i > 0 else before
        if previous is not None:
            frame.change, box = difference_with_region(gray, previous, GRAY_WIDTH)
            if box:
                x0, y0, x1, y1 = box
                frame.region = (x0 * k, y0 * k, (x1 - x0 + 1) * k, (y1 - y0 + 1) * k)
        frame.to_final = mean_difference(gray, final)


def median(values: list[float]) -> float:
    return statistics.median(values) if values else 0.0


def flag(frames: list[Frame]) -> float:
    """Ставит gap/jump (§3.3.4). Возвращает медиану интервалов менявшихся кадров."""
    peak = max((f.change for f in frames), default=0.0)
    typical = median([f.interval_ms for f in frames if f.change >= STILL and f.interval_ms is not None])
    changes = [f.change for f in frames]
    for i, frame in enumerate(frames):
        if (
            typical > 0
            and frame.interval_ms is not None
            and frame.interval_ms > 1.5 * typical
            and peak > 0
            and frame.change >= 0.05 * peak
        ):
            frame.flags.append("gap")
        neighbours = changes[max(0, i - 3):i] + changes[i + 1:i + 4]
        if frame.change > 1.0 and frame.change > 3 * median(neighbours):
            frame.flags.append("jump")
    return typical


@dataclass
class Summary:
    motion_start: float | None
    motion_end: float | None
    settled_at: float | None
    settle_threshold: float
    passes: list[tuple[int, float, float]]  # номер, время, % от стартового расстояния
    typical_interval: float


def summarize(frames: list[Frame], typical: float) -> Summary:
    moving = [f for f in frames if f.change >= STILL]
    distances = [f.to_final for f in frames]
    threshold = max(0.3, 0.02 * max(distances))
    # Успокоение: с этого кадра и до конца кривая не выходит из коридора у покоя.
    settled = len(frames)
    while settled > 0 and distances[settled - 1] <= threshold:
        settled -= 1
    settled_at = frames[settled].time if settled < len(frames) else None
    # «Проход через покой»: провал ниже 25 % старта, после которого кривая снова
    # поднимается больше чем на этот порог — перелёт или возврат.
    passes: list[tuple[int, float, float]] = []
    start = distances[0]
    if start > 0:
        dip = 0.25 * start
        for i in range(1, len(frames) - 1):
            here = distances[i]
            # Строгий спуск слева: плато у покоя — один проход, а не по проходу на кадр.
            if here < dip and here < distances[i - 1] and here <= distances[i + 1]:
                if max(distances[i + 1:]) - here > dip:
                    passes.append((frames[i].index, frames[i].time, 100 * here / start))
    return Summary(
        motion_start=moving[0].time if moving else None,
        motion_end=moving[-1].time if moving else None,
        settled_at=settled_at,
        settle_threshold=threshold,
        passes=passes,
        typical_interval=typical,
    )


# MARK: - Картинки


def font_file() -> str | None:
    if shutil.which("fc-match"):
        found = subprocess.run(["fc-match", "-f", "%{file}", "DejaVu Sans Mono"], capture_output=True, text=True)
        if found.returncode == 0 and Path(found.stdout).is_file():
            return found.stdout
    for candidate in ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/System/Library/Fonts/Menlo.ttc"):
        if Path(candidate).is_file():
            return candidate
    return None


def drawtext(text: str, x: str, y: str, size: int, color: str = "black") -> str:
    # Текст без кавычек и обратных слэшей — экранировать нечего, кроме ':' внутри кавычек
    # (он там безопасен); expansion=none — чтобы '%' не разбирался как шаблон.
    font = font_file()
    font_part = f"fontfile='{font}':" if font else ""
    safe = text.replace("\\", "/").replace("'", "’")
    return f"drawtext={font_part}expansion=none:text='{safe}':x={x}:y={y}:fontsize={size}:fontcolor={color}"


def extract(video: Path, geo: Geometry, first: int, last: int, folder: Path) -> list[Path]:
    """PNG кадров диапазона по номеру кадра, приведённые к точкам."""
    folder.mkdir(parents=True, exist_ok=True)
    for stale in folder.glob("*.png"):
        stale.unlink()
    temporary = folder / "raw-%05d.png"
    call([
        "ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-i", str(video),
        "-vf", f"select='between(n\\,{first}\\,{last})',{geo.crop_filter},scale={geo.tile_width}:-2:flags=area",
        "-fps_mode", "passthrough", str(temporary),
    ])
    raw = sorted(folder.glob("raw-*.png"))
    expected = last - first + 1
    if len(raw) != expected:
        raise FramesError(f"ffmpeg извлёк {len(raw)} кадров диапазона, ожидалось {expected}")
    named = []
    for offset, path in enumerate(raw):
        target = folder / f"{first + offset:05d}.png"
        path.rename(target)
        named.append(target)
    return named


def label(frame: Frame) -> str:
    step = f"+{frame.interval_ms:.0f}" if frame.interval_ms is not None else "+—"
    text = f"#{frame.index} t={frame.time:.3f} {step}"
    return f"{text} {' '.join(frame.flags)}" if frame.flags else text


def sheets(frames: list[Frame], images: list[Path], out: Path, columns: int, rows: int, tile_width: int) -> list[Path]:
    per_sheet = columns * rows
    # Подпись читается и на узкой кропнутой плитке, и на целом экране.
    font_size = max(11, min(18, tile_width // 22))
    result = []
    for sheet, start in enumerate(range(0, len(frames), per_sheet), start=1):
        batch = list(zip(frames[start:start + per_sheet], images[start:start + per_sheet]))
        inputs: list[str] = []
        chains: list[str] = []
        for i, (frame, image) in enumerate(batch):
            inputs += ["-i", str(image)]
            steps = [f"pad=iw:ih+{LABEL_HEIGHT}:0:0:color=white", drawtext(label(frame), "4", f"h-{LABEL_HEIGHT - 4}", font_size)]
            if frame.flags:
                steps.append("drawbox=x=0:y=0:w=iw:h=ih:color=red:t=4")
            chains.append(f"[{i}:v]{','.join(steps)}[c{i}]")
        # Неполный последний лист добиваем пустыми плитками: `tile` ждёт целую сетку.
        blanks = per_sheet - len(batch)
        streams = "".join(f"[c{i}]" for i in range(len(batch)))
        if blanks:
            chains.append(f"[c0]split=2[c0a][c0b]")
            streams = streams.replace("[c0]", "[c0a]", 1)
            chains.append(f"[c0b]drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill,tpad=stop={blanks - 1}:stop_mode=clone[blank]")
            streams += "[blank]"
            count = len(batch) + 1
        else:
            count = len(batch)
        chains.append(f"{streams}concat=n={count}:v=1:a=0,tile={columns}x{rows}:padding=4:margin=4:color=gray[out]")
        target = out / f"sheet-{sheet:02d}.png"
        call(["ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-y", *inputs,
              "-filter_complex", ";".join(chains), "-map", "[out]", "-frames:v", "1", str(target)])
        result.append(target)
    return result


def write_png(path: Path, width: int, height: int, pixels: bytearray) -> None:
    stride = width * 3
    raw = b"".join(b"\x00" + bytes(pixels[y * stride:(y + 1) * stride]) for y in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


class Canvas:
    def __init__(self, width: int, height: int, background=(255, 255, 255)):
        self.width, self.height = width, height
        self.pixels = bytearray(bytes(background) * (width * height))

    def dot(self, x: int, y: int, color) -> None:
        if 0 <= x < self.width and 0 <= y < self.height:
            at = (y * self.width + x) * 3
            self.pixels[at:at + 3] = bytes(color)

    def rect(self, x0: int, y0: int, x1: int, y1: int, color) -> None:
        for y in range(max(0, min(y0, y1)), min(self.height, max(y0, y1) + 1)):
            for x in range(max(0, min(x0, x1)), min(self.width, max(x0, x1) + 1)):
                self.dot(x, y, color)

    def line(self, x0: int, y0: int, x1: int, y1: int, color, thick: int = 1) -> None:
        steps = max(abs(x1 - x0), abs(y1 - y0), 1)
        for s in range(steps + 1):
            x = round(x0 + (x1 - x0) * s / steps)
            y = round(y0 + (y1 - y0) * s / steps)
            self.rect(x - thick // 2, y - thick // 2, x + (thick - 1) // 2, y + (thick - 1) // 2, color)


def motion_chart(frames: list[Frame], summary: Summary, out: Path) -> Path:
    """График: линия — `to_final` (насколько кадр ещё далёк от покоя), столбики —
    `change`, зелёная вертикаль — успокоение, красные риски — gap/jump."""
    width, height, margin, top = 1000, 380, 40, 44
    canvas = Canvas(width, height)
    left, right, bottom = margin, width - margin, height - margin
    t0, t1 = frames[0].time, frames[-1].time
    span = max(t1 - t0, 1e-6)
    far = max(max(f.to_final for f in frames), 1e-6)
    peak = max(max(f.change for f in frames), 1e-6)

    def x_of(t: float) -> int:
        return round(left + (right - left) * (t - t0) / span)

    def y_of(value: float, ceiling: float, share: float = 1.0) -> int:
        return round(bottom - (bottom - top) * share * value / ceiling)

    canvas.rect(left, top, right, bottom, (248, 248, 250))
    for tick in range(0, int(span * 10) + 1):  # сетка по 0,1 с
        x = x_of(t0 + tick / 10)
        canvas.line(x, top, x, bottom, (226, 226, 232) if tick % 10 else (190, 190, 200))
    for frame in frames:
        x = x_of(frame.time)
        canvas.rect(x - 1, y_of(frame.change, peak, 0.4), x + 1, bottom, (170, 170, 180))
    threshold_y = y_of(summary.settle_threshold, far)
    for x in range(left, right, 8):
        canvas.line(x, threshold_y, x + 3, threshold_y, (60, 160, 90))
    if summary.settled_at is not None:
        x = x_of(summary.settled_at)
        canvas.line(x, top, x, bottom, (40, 150, 70), thick=2)
    for a, b in zip(frames, frames[1:]):
        canvas.line(x_of(a.time), y_of(a.to_final, far), x_of(b.time), y_of(b.to_final, far), (30, 90, 200), thick=2)
    for frame in frames:
        canvas.rect(x_of(frame.time) - 1, y_of(frame.to_final, far) - 1, x_of(frame.time) + 1, y_of(frame.to_final, far) + 1, (20, 60, 160))
        if frame.flags:
            x = x_of(frame.time)
            canvas.rect(x - 1, top - 10, x + 1, top - 2, (220, 40, 40))
    canvas.line(left, bottom, right, bottom, (90, 90, 100))
    canvas.line(left, top, left, bottom, (90, 90, 100))
    bare = out / "motion-bare.png"
    write_png(bare, width, height, canvas.pixels)
    # Подписи — через drawtext ffmpeg: свой растровый шрифт ради трёх строк не нужен.
    target = out / "motion.png"
    legend = "линия — to_final (до покоя)   столбики — change   зелёная — успокоение   красные — gap/jump"
    axis = f"t {t0:.3f} … {t1:.3f} c, сетка 0,1 с; to_final max {far:.2f}, change max {peak:.2f}"
    call([
        "ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-y", "-i", str(bare),
        "-vf", ",".join([drawtext(legend, str(left), "8", 14), drawtext(axis, str(left), str(height - 26), 13, "0x555555")]),
        "-frames:v", "1", str(target),
    ])
    bare.unlink()
    return target


# MARK: - Отчёт


def write_table(frames: list[Frame], path: Path) -> None:
    lines = ["index\tt\tinterval_ms\tchange\tto_final\tregion_pt\tflags"]
    for f in frames:
        region = ",".join(f"{v:.0f}" for v in f.region) if f.region else ""
        interval = f"{f.interval_ms:.1f}" if f.interval_ms is not None else ""
        lines.append(f"{f.index}\t{f.time:.4f}\t{interval}\t{f.change:.3f}\t{f.to_final:.3f}\t{region}\t{','.join(f.flags)}")
    path.write_text("\n".join(lines) + "\n")


def report(video: Path, geo: Geometry, total: int, frames: list[Frame], summary: Summary, sheet_paths: list[Path]) -> str:
    def at(t: float | None) -> str:
        return f"{t:.3f} c" if t is not None else "—"

    flagged = [f for f in frames if f.flags]
    x, y, w, h = geo.crop_px
    lines = [
        f"запись: {video} — {total} кадров (ffprobe = ffmpeg), K = {geo.scale:.3f} px/pt",
        f"область: {w}×{h} px от ({x},{y}) = {w / geo.scale:.0f}×{h / geo.scale:.0f} pt; кадр листа {geo.tile_width} pt",
        f"диапазон: #{frames[0].index}…#{frames[-1].index}, t {frames[0].time:.3f}…{frames[-1].time:.3f} c, {len(frames)} кадров",
        f"медиана интервала менявшихся кадров: {summary.typical_interval:.1f} мс",
        f"движение: {at(summary.motion_start)} … {at(summary.motion_end)}",
        f"в пределах {summary.settle_threshold:.2f} от покоя навсегда: с {at(summary.settled_at)}",
    ]
    if summary.passes:
        lines.append("проходы через покой: " + ", ".join(f"#{i} t={t:.3f} ({pct:.0f} % старта)" for i, t, pct in summary.passes))
    else:
        lines.append("проходы через покой: нет")
    if flagged:
        lines.append("помеченные кадры (открыть плитки вокруг и назвать причину):")
        lines += [f"  #{f.index} t={f.time:.3f} +{f.interval_ms or 0:.0f} мс change={f.change:.2f}: {', '.join(f.flags)}" for f in flagged]
    else:
        lines.append("помеченных кадров нет")
    lines.append("листы: " + ", ".join(p.name for p in sheet_paths))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Листы кадров и метрики движения из записи экрана (IOS_RULES §3.3).")
    parser.add_argument("video", type=Path)
    parser.add_argument("--out", type=Path, required=True, help="каталог разбора (scratchpad, не репозиторий)")
    parser.add_argument("--start", type=float, help="начало диапазона, с по часам записи")
    parser.add_argument("--end", type=float, help="конец диапазона, с по часам записи")
    parser.add_argument("--crop", help="область X,Y,W,H в точках")
    parser.add_argument("--columns", type=int, default=8)
    parser.add_argument("--rows", type=int, default=4)
    parser.add_argument("--points-width", type=float, default=402, help="ширина экрана в pt (iPhone 17 Pro — 402)")
    parser.add_argument("--tile-width", type=int, help="ширина кадра на листе в pt; по умолчанию — ширина области")
    args = parser.parse_args(argv)

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            print(f"нет {tool} в PATH", file=sys.stderr)
            return 2
    if args.columns < 1 or args.rows < 1:
        parser.error("--columns и --rows — положительные")
    try:
        geo = make_geometry(stream_size(args.video), args.points_width, args.crop, args.tile_width)
        times = frame_times(args.video)
        chosen = [
            i for i, t in enumerate(times)
            if (args.start is None or t >= args.start) and (args.end is None or t <= args.end)
        ]
        if not chosen:
            raise FramesError("в диапазоне --start/--end нет кадров")
        first, last = chosen[0], chosen[-1]
        total, grays, before = read_gray(args.video, geo, first, last)
        if total != len(times):
            raise FramesError(f"ffprobe насчитал {len(times)} кадров, ffmpeg — {total}: время кадров не сопоставить")
        frames = [
            Frame(index=i, time=times[i], interval_ms=(times[i] - times[i - 1]) * 1000 if i > 0 else None)
            for i in range(first, last + 1)
        ]
        measure(frames, grays, before, geo)
        summary = summarize(frames, flag(frames))
        args.out.mkdir(parents=True, exist_ok=True)
        images = extract(args.video, geo, first, last, args.out / "frames")
        sheet_paths = sheets(frames, images, args.out, args.columns, args.rows, geo.tile_width)
        motion_chart(frames, summary, args.out)
        write_table(frames, args.out / "frames.tsv")
        text = report(args.video, geo, total, frames, summary, sheet_paths)
    except FramesError as error:
        print(f"стоп: {error}", file=sys.stderr)
        return 1
    (args.out / "summary.txt").write_text(text + "\n")
    print(text)
    print(f"разбор: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
