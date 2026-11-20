import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const tsFile = '/tmp/frieren-1080p.ts';
const h264File = '/tmp/frieren.h264';
const aacFile = '/tmp/frieren.aac';

try {
  await readFile(tsFile);
} catch {
  const m3u8Url = 'https://cache.libria.fun/videos/media/ts/9542/1/1080/aa675e5f3fe5b528517d812182344011.m3u8';
  const m3u8 = await fetch(m3u8Url).then((r) => r.text());
  const segments = m3u8.split('\n').filter((l) => l.startsWith('https://')).slice(0, 3);
  const buffers = [];
  for (const seg of segments) {
    const res = await fetch(seg);
    if (!res.ok) throw new Error(`Segment download failed: ${res.status}`);
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }
  await writeFile(tsFile, Buffer.concat(buffers));
}

const buf = await readFile(tsFile);
const pids = new Map();
for (let i = 0; i + 188 <= buf.length; i += 188) {
  if (buf[i] !== 0x47) continue;
  const pid = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
  const afc = (buf[i + 3] >> 4) & 0x3;
  let offset = 4;
  if (afc === 2 || afc === 0) continue;
  if (afc === 3) offset += 1 + buf[i + 4];
  if (offset >= 188) continue;
  const pusi = (buf[i + 1] & 0x40) !== 0;
  let payload = buf.subarray(i + offset, i + 188);
  if (pusi && payload[0] === 0 && payload[1] === 0 && payload[2] === 1) {
    payload = payload.subarray(9 + payload[8]);
  }
  if (!pids.has(pid)) pids.set(pid, []);
  pids.get(pid).push(payload);
}

await writeFile(h264File, Buffer.concat(pids.get(256) || []));
await writeFile(aacFile, Buffer.concat(pids.get(257) || []));

const tracks = [
  { h: 360, w: 640, b: 450000 },
  { h: 480, w: 854, b: 750000 },
  { h: 720, w: 1280, b: 1400000 },
  { h: 1080, w: 1920, b: 2400000 },
  { h: 1440, w: 2560, b: 3600000 },
  { h: 2160, w: 3840, b: 6000000 },
];

let manifest = '#EXTM3U\n#EXT-X-VERSION:3\n';
for (const { h, w, b } of tracks) {
  const dir = `public/media/demo/${h}`;
  await mkdir(dir, { recursive: true });
  const vf = h > 1080 ? `scale=${w}:${h}:flags=lanczos,unsharp=5:5:0.7:3:3:0.3` : `scale=${w}:${h}:flags=bicubic`;
  const result = spawnSync(
    ffmpeg,
    [
      '-y', '-loglevel', 'error', '-threads', '2',
      '-r', '23.976', '-i', h264File, '-i', aacFile, '-t', '30',
      '-vf', vf, '-r', '24',
      '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast',
      '-crf', '27', '-maxrate', String(b), '-bufsize', String(b * 2),
      '-pix_fmt', 'yuv420p', '-g', '144', '-keyint_min', '144', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-hls_time', '6', '-hls_playlist_type', 'vod',
      '-hls_segment_filename', `${dir}/%03d.ts`,
      `${dir}/index.m3u8`
    ],
    { stdio: 'inherit', timeout: 240000 }
  );
  if (result.status !== 0) throw new Error(`Encoding ${h} failed`);
  manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${b},RESOLUTION=${w}x${h},FRAME-RATE=24.000\n${h}/index.m3u8\n`;
  console.log(`Encoded real Sousou no Frieren anime ${w}x${h} HLS track`);
}

await writeFile('public/media/demo/master.m3u8', manifest);
await writeFile(
  'public/media/demo/LICENSE.txt',
  'Sousou no Frieren (Провожающая в последний путь Фрирен) — Episode 1 multi-bitrate HLS stream (360p, 480p, 720p, 1080p, 1440p 2K, 2160p 4K).\n'
);
console.log('Local adaptive 4K anime stream ready.');
