# Prompt para agente local — D6: captura completa A0.6.3 → A0.6.4

> Copiar el texto siguiente en GPT-6.1 High / Claude Opus 5.5 con acceso al checkout local de `gng-ghidra` y Docker/Colima. **Primero leer** `docs/audit/a063-m5-d6-full-native-handoff.md`.

---

Eres el ingeniero responsable de cerrar el bloque **M5.D6** de `krukmat/gng-ghidra` con validación nativa, manteniendo integridad forense y cambios mínimos.

**Rama de trabajo:** `feature/a063-r1-forensics-contract`. **No modificar `main`.** Cero gasto adicional. Solo Mac M5 Pro + Docker/Colima Linux ARM64.

## Baseline innegociable

- **D5 PASS real:** `A063_ORACLE_MINIPROBE=PASS_SAMPLED_INSTRUCTIONS_ONLY_NOT_FULL_A063`. 41.426 preestados, MAME exit=0, pre/postflight íntegro. Confirmado mediante salida de terminal del operador.
- **D5 volumen bueno:** `gng-a063-private-capture-arm64-delimited-v2`. **No tocar** ni volver a montar RW. El volumen `gng-a063-private-capture-arm64-v1` guarda el primer fallo y también se preserva.
- **MAME listo:** volumen `gng-a063-mame0289-arm64-v1`, ELF `/mame/mame0289/gnga063`, SHA-256 `80c447cd81fa91be8bf3159e22dedab157798a4f1a189e6680849179b0ac282d`; no recompilar.
- Último fix D5: delimitador de `tracelog` en `scripts/a063_trace_contract.py`, commit `98bcb80`.
- **A0.6.3/A0.6.4 todavía no certificados**. El PASS del mini-oráculo no acredita captura completa con soft reset, sprite/MMIO/VRAM ni código JS generado.

## Instrucción de trabajo

Lee `docs/audit/a063-m5-d6-full-native-handoff.md` (fuente de verdad de tareas D6.T0–T3). Inspecciona las implementaciones **reales** de:

- `scripts/r3-bank-provenance-capture.sh`
- `scripts/r3-video-write-capture.sh`, `scripts/r3-mmio-read-capture.sh`, `scripts/r2-mame-probe.sh`, `scripts/r2-mame-probe.lua`
- `scripts/a063_trace_contract.py`, `scripts/a063_capture_integrity.py`, `scripts/a063_bank_oracle_gate.py`, `scripts/r3_bank_provenance.py`
- `scripts/r3-banked-critical-path.sh` y `scripts/r3_banked_static_gate.mjs`
- Sus tests ROM-free y documentación.

**Hallazgo que debes abordar:** el runner `r3-bank-provenance-capture.sh` prepara firmas `b@`, pero no activa el `--oracle` ni fuerza el símbolo nativo `gng_a063_bank` en la captura completa. El postflight de modo oracle actualmente restringe el directorio al mini-smoke. `r3_bank_provenance.py report` valida firmas, pero no exige la igualdad con `E_live`. Además, la captura completa con soft reset no puede evaluarse con la política de `compare()` del mini-oráculo que rechaza cualquier reset. Por tanto, **integrar estos componentes antes de lanzar MAME**.

### D6.T0 — Estado y riesgos
Verifica rama, cambios locales, recursos y SHA del MAME mediante lecturas; revisa mini-oráculo v2 **read-only**, sin imprimir ROM ni CPU/PC. Reporta dependencias y brechas confirmadas.

### D6.T1 — Implementación + tests (primer checkpoint obligatorio)
1. Incorpora un modo explícito full-oracle al runner completo, con preflight `--oracle`, acción atómica de 12 expresiones (9 CPU + 2 firmas ROM + E), mismo output `out/r2/mame-probe` y flags nativos originales para sprite, video, política MMIO y soft reset.
2. Adapta postflight/preflight y validación de banco E **solamente** para el destino completo permitido, rechazando artefactos o fuentes inconsistentes; separa contrato mini de full, con epochs/reset y enlace 1:1. Rechaza E 5+, discrepancias, saltos de seq, PC/CPU y firmas inválidas; nunca máscaras/truncamientos ni inferencias por frame.
3. Asegura que `r3_bank_provenance.py report` no emite witness privado ni status PASS sin coincidencia E↔ROM **en todos** los preestados y sin comprobar manifest/hash de la misma captura. Integra exigencias previas de selector post-write y dos epochs para los gates de boot/video.
4. Añade tests ROM-free sintéticos adversariales y ejecuta `TMPDIR=/private/tmp bash scripts/a063-r2b-romfree.sh` más los tests dirigidos. Documenta limitaciones de A0.6.4. No modificar el binario C++.

**Checkpoint:** D6.T1 `PASS_ROM_FREE_ONLY` (o `BLOCKED` con causa); commit de código+tests+documentación saneados en la feature branch. **No crear preflight nuevo mientras edites archivos sujetos a `SOURCE_FILES`.**

### D6.T2 — Diseño seguro de recaptura
Prepara y valida un **único comando** para una nueva captura privada en volumen **nuevo inexistente**, por ejemplo `gng-a063-private-capture-arm64-full-d6-v1`. `v1` y `v2` permanecen intactos. Repositorio/MAME read-only, captura `out/` propia RW, `--network none`, `--platform linux/arm64`, `--pull never`, `xvfb-run`, `timeout`, log bruto solo en volumen privado y salida terminal saneada. Verificar ramas/hash/fuentes y rechazar reintentos que pisen un volumen parcial.

**No ejecutes T2 sin haber pasado T1 y presentado el comando y sus condiciones.** Si el operador te autoriza expresamente a continuar con captura, ejecútala solo en volumen nuevo y conserva los artefactos en cualquier fallo.

### D6.T3 — Gates nativos sobre una sola corrida
Cuando T2 esté completa, comprobar realmente el full-oracle 1:1, post-write, epochs, SHA manifest y witness; después correr A0.6.4 con sprite/boot/MMIO/VRAM y static codegen usando **exclusivamente ese volumen y la misma captura**. No mezcles artefactos de sesiones. Estado PASS solo bajo las condiciones efectivas de los contratos, nunca por PASS sintético.

## Restricciones absolutas

- No tocar `main`, no `stash`, `reset`, `clean`, `git add -A` ni borrar volúmenes.
- No descargar o cargar ROMs, traces, JSONL con PC/register/bank, manifiestos privados, binarios MAME ni dumps; no enviarlos al proveedor de modelo, PR o logs versionados. **Solo estados y contadores saneados** fuera del Mac.
- No realizar rebuild ni recaptura innecesarios.
- No relajar `fail-closed`, no ocultar divergencias, no anunciar juego ejecutable ni equivalencia CPU/IRQ/bus total.
- Documenta archivos y commits, pruebas PASS reales vs no ejecutadas, y el siguiente paso en una frase.

## Formato de respuesta obligatorio

Cada checkpoint debe comenzar con barras visibles, por ejemplo:

```text
D6.T0  [██████████] 100% PASS
D6.T1  [██████░░░░]  60% IN_PROGRESS
D6.T2  [░░░░░░░░░░]   0% PENDING
D6.T3  [░░░░░░░░░░]   0% BLOCKED_BY_T2
```

Trabaja en bloques y con subtareas de máximo dos niveles. **Prioridad inmediata: T0 y T1**, entregar código probado y comando seguro para T2, sin adelantarte a la captura real.

