# B-AUDIO-2 — Z80 AOT y YM2203 (2026-10-27)

Repo: krukmat/gng-ghidra, branch main.
Status: PARTIAL — código y tests sintéticos escritos. Ninguna ROM personal, MAME ni compilación ymfm nativa ha sido ejecutada aquí; **no hay audio del juego certificado**. No se modifica el engine MC6809 ni el bot.

## Estado de las tareas

| Task | Implementación | Gate |
| --- | --- | --- |
| A2.T1 | scripts/audio_extract_sound_rom.py, preflight B1, capturador MAME | NEEDS_MAC, sin ROM real verificada |
| A2.T2 | src/gngb_z80_static_codegen.mjs (Z80 AOT offline limitado), scripts/audio_z80_build.mjs (SHA-1 obligado), src/gngb_z80_sound_bus.mjs (ROM/RAM/latch/reset/YM/12MHz) | PARTIAL, instrucciones Z80 completas e IRQ 240 Hz pendientes |
| A2.T3 | src/audio_ym2203_lab.cpp + scripts/audio_ym_native_build.sh; 2 chips ymfm con mezcla FM/PSG | PREPARED, no compilado en Mac |
| A2.T4 | scripts/audio_ym_events_to_tsv.py; eventos YM nativos a WAV mono 62500 Hz en out/audio | PREPARED, sin evento real ni WAV verificado |
| A2.T5 | src/gngb_audio_pcm_queue.mjs, gngb_audio_pcm_processor.mjs y gngb_audio_worklet_sink.mjs | TRANSPORT_ONLY, productor Z80/ymfm WASM y resampling pendientes |

Fuente de hardware: https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp
Dependencia de síntesis: https://github.com/aaronsgiles/ymfm/commit/81aec25ccbb98f4873a255f7551ac4dadac59b4a (BSD-3-Clause).

## Checkpoint ROM-free — ejecutar desde la raíz del repo

    git checkout main && git pull --ff-only
    node --test tests/test_gngb_z80_static_codegen.mjs tests/test_gngb_z80_sound_bus.mjs tests/test_gngb_audio_pcm_queue.mjs tests/test_gngb_audio_events.mjs
    python3 -m unittest discover -s tests -p 'test_audio_*.py' -v
    node --check src/gngb_audio_pcm_processor.mjs

Se validaron manualmente contratos JavaScript aislados, pero **no** la suite completa del checkout. Comunicar salidas sin extrapolar PASS.

## Checkpoint privado — Z80 ROM original

    python3 scripts/audio_rom_preflight.py --rom roms/gngb.zip --shared roms/gng.zip
    python3 scripts/audio_extract_sound_rom.py --rom roms/gngb.zip --shared roms/gng.zip
    node scripts/audio_z80_build.mjs out/audio/gg2.bin out/audio/z80-prefix.mjs

El compilador espera detectar opcodes aún no soportados. Un exit 2 con PARTIAL_UNCERTIFIED es bloqueo deliberado, no juego sonoro. La salida es **ROM-derived** y queda exclusivamente en out/audio ignorado por Git.

## Primer WAV de laboratorio desde registros YM2203 auténticos

    mkdir -p out/vendor out/audio
    git clone https://github.com/aaronsgiles/ymfm.git out/vendor/ymfm
    git -C out/vendor/ymfm checkout 81aec25ccbb98f4873a255f7551ac4dadac59b4a
    bash scripts/audio_ym_native_build.sh out/vendor/ymfm

Usar la misma revisión MAME, ROM, DIPs y secuencia Coin/Start/ataque que se valida con el engine. Capturar un tramo corto, cerrar MAME antes de continuar:

    GNG_AUDIO_TAP_OUT=out/audio/mame-audio-events.jsonl \
      mame gngb -rompath roms -autoboot_script scripts/audio_mame_taps.lua -autoboot_delay 0

    python3 scripts/audio_ym_events_to_tsv.py \
      --in-jsonl out/audio/mame-audio-events.jsonl \
      --out-tsv out/audio/ym-writes.tsv --window-ms 15000

    out/audio/ym2203_lab out/audio/ym-writes.tsv out/audio/ym-lab.wav 16000

El tiempo de la cinta YM se normaliza al primer evento y conserva el intervalo relativo. Se limita a 15 segundos de eventos y 1 segundo adicional de decaimiento. Nunca se debe presentar este WAV como audio end-to-end del producto: procede de escrituras YM observadas en MAME y permite **solo** validar la síntesis independiente. Si falla el tap de MAME, falta la ROM, no hay eventos, hay un error de compilación o la salida es silenciosa, STOP con diagnóstico.

## Dependencias siguientes antes de declarar G5 GO

- Completar el subconjunto Z80 requerido por gg2.bin incluyendo CB/ED/DD/FD, flags, puertos, 240Hz IRQ, EI delay, reset y paridad contra MAME.
- Sustituir la cinta nativa de laboratorio por eventos YM procedentes de la Z80 AOT en tiempo real.
- Integrar ymfm como WASM con los temporizadores y ganancias originales, y convertir 62.5 kHz a AudioContext.sampleRate mediante resampler explícito.
- Conectar el productor al AudioWorklet con underruns, drift, mute, reset, pausa y detección de latencia.
- Certificar música, disparos, daño/muerte, cambio de fase y sesiones largas junto a video/controles.

**Gate actual:** B-AUDIO-2 PARTIAL. G5 y H5 no están completados. Ninguna ROM, sonido ni artefacto derivado se ha publicado.
