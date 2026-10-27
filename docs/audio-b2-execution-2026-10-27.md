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


## Actualización tras el primer checkpoint local (27/10/2026)

Operador, MacBook M5: 11 tests Python / 11 PASS; extracción privada de gg2.bin: IDENTITY_PASS, 32768 bytes. El compilador AOT registró PARTIAL_UNCERTIFIED, compiled=0, unsupported=1 y pending=0. **ROM ID GO, Z80 prefijo todavía STOP.** No se comunicó salida de Node ni ejecución MAME/ymfm. No equivale a audio.

El compilador se amplió con clasificación ROM-private del primer bloqueo, sin exportar bytes de ROM. Las pruebas aisladas del clasificador sintético pasaron (12 familias); la suite del repositorio no se ejecutó en este entorno. La revisión tras git pull debe incluir el campo first_blocker (pc, family, reason), sin opcode ni dump.

### Única acción local necesaria para identificar la ruta Z80

    git checkout main && git pull --ff-only
    node --test tests/test_gngb_z80_static_codegen.mjs
    node scripts/audio_z80_build.mjs out/audio/gg2.bin out/audio/z80-prefix.mjs

Es **normal** que el tercer comando termine con exit code 2 cuando aparece un opcode sin soporte. Compartir únicamente el JSON que empieza por GNG_AUDIO_Z80_AOT_PREFIX_V1, particularmente first_blocker. NO enviar out/audio, ROM, capturas de memoria ni código recompilado.

**Siguiente tarea A2.T2a:** implementar solamente las familias de instrucciones identificadas (y sus flags/ciclos/interrupciones si procede), añadir pruebas sintéticas y reejecutar la misma ROM hasta una nueva frontera. STOP ante divergencia con MAME; no medir éxito por bloques arbitrarios. La síntesis YM independiente puede seguirse en paralelo según las instrucciones anteriores.


## Checkpoint A2.T2b — ED detectada en la ROM original (27/10/2026)

Resultado del operador: 4/4 tests Node PASS; ROM sonora autenticada en la validación anterior. El compilador anterior se bloqueó en PC 0, familia ED_EXTENDED_PREFIX, compiled=0, unsupported=1. Es una instrucción no implementada, no una ROM defectuosa.

Cambios realizados en main:
- Compilación AOT de ED IM 0/1/2 (incluidas aliases), dos bytes, ocho T-states, flags inalterados.
- Compilación AOT de ED NEG (incluidas aliases), dos bytes, ocho T-states, flags S/Z/F5/H/F3/PV/N/C.
- Compilación AOT de ED LD I,A, dos bytes, nueve T-states, sin alterar flags.
- Diagnóstico detallado de ED no soportado: first_blocker.ed_instruction contiene una categoría de instrucción, nunca el byte, operando o contenido de ROM.
- Tests sintéticos de ED y verificación aislada de ejecución de bloques generados. Los tests Node de la rama actual aún deben ejecutarse en Mac.

La subinstrucción ED inicial concreta es desconocida en este hilo: no asumir que sea IM. No añadir opcodes por especulación.

### Próximo gate en Mac

    git checkout main && git pull --ff-only
    node --test tests/test_gngb_z80_static_codegen.mjs
    node scripts/audio_z80_build.mjs out/audio/gg2.bin out/audio/z80-prefix.mjs

El tercer comando puede acabar en exit 2 por una nueva instrucción no soportada: STOP esperado. Compartir solamente el JSON GNG_AUDIO_Z80_AOT_PREFIX_V1 y first_blocker (pc/family/ed_instruction si lo hay). No enviar gg2.bin, compilación derivada, trazas, out/audio ni bytes de ROM. Ninguna paridad de Z80 o audio se certifica por tests sintéticos.
