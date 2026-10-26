# A0.6.3 → A0.6.4 | M5.D6 — handoff de captura completa y gates nativos

**Fecha:** 2026-10-25  
**Repositorio:** `krukmat/gng-ghidra` (privado)  
**Rama exclusiva:** `feature/a063-r1-forensics-contract`; `main` no se modifica.  
**Checkpoint de entrada:** `D5_NATIVE_MINIPROBE_PASS_NOT_FULL_A063` (**declarado por el operador y confirmado por su salida de terminal**).  
**Estado actual (2026-10-26):** D6.T0–T3 ejecutadas. T2 v2 PASS con 17.135
preestados, cuatro frames, MAME/launcher exit 0. T3 exit 0:
`A063_FULL_NATIVE_BANK_PROVENANCE_PASS` y
`BANKED_CODEGEN_WITH_NATIVE_CHECKPOINT_PREFIX_ONLY`.
[Cierre nativo, evidencia y límites](a063-m5-d6-native-closure.md).
No se declara equivalencia global A0.6.4 ni primer frame autónomo.
**Coste incremental:** 0 EUR; únicamente Mac M5 Pro + Colima/Docker local ARM64.

## 1. Evidencia de entrada — NO repetir trabajo superado

- M5.D0–D4 PASS: MAME 0.289 parcheado, Linux ELF AArch64, `gngb` y símbolo `gng_a063_bank` comprobados.
- Binario **existente**: `/mame/mame0289/gnga063` en volumen `gng-a063-mame0289-arm64-v1`. SHA-256: `80c447cd81fa91be8bf3159e22dedab157798a4f1a189e6680849179b0ac282d`.
- D5 primer intento (`gng-a063-private-capture-arm64-v1`): 41.426 preestados, parser inicial rechazó `A063_ORACLE_BANK_OUT_OF_RANGE` por concatenación de `E` y PC. **Conservarlo como evidencia histórica inválida.**
- Fix ROM-free incorporado en commit `98bcb80efc6111fa3cbb0f29ed8896ddf8b9876c`: espacio delimitador en `scripts/a063_trace_contract.py`. Tests sintéticos 9/9 y gate ROM-free reportados PASS.
- D5 repetido en volumen **`gng-a063-private-capture-arm64-delimited-v2`**: MAME exit=0, 41.426 preestados, postflight íntegro, `A063_ORACLE=A063_ORACLE_MINIPROBE_NATIVE_MATCHED_NOT_FULL_A063` y `A063_ORACLE_MINIPROBE=PASS_SAMPLED_INSTRUCTIONS_ONLY_NOT_FULL_A063`.
- D6 v1 se conserva con su bloqueo histórico de B4. Después de corregir y validar la duración sin cambiar gates, D6 v2 pasó T2/T3 y el full-oracle sobre 17.135 preestados. El codegen mantiene su estado limitado; el mini-oráculo D5 no se usa como sustituto de esa evidencia. Ver cierre nativo para distinguir ambas corridas.

Referencia: `docs/audit/a063-m5-d5-delimiter-diagnosis.md` y `docs/a063-m5-docker-plan.md`.

## 2. Diagnóstico histórico previo a T1 (revisión de fuente en GitHub)

Las brechas de esta tabla motivaron T1 y ya están abordadas en el
[checkpoint ROM-free](a063-m5-d6-full-native-romfree.md). El estado operativo
vigente es el [cierre nativo D6](a063-m5-d6-native-closure.md).

| Fuente | Estado observado / brecha a resolver |
|---|---|
| `scripts/a063-native-oracle-miniprobe.sh` | Oráculo nativo solo en `out/r3/a063-oracle-smoke`, 3 s emulados y frames limitados. No es runner completo. |
| `scripts/r3-bank-provenance-capture.sh` | Preflight **sin `--oracle`**; usa dos firmas `b@`, pero **no pasa ni exige** `gng_a063_bank` en captura completa. |
| `scripts/r3-video-write-capture.sh` → `r3-mmio-read-capture.sh` → `r2-mame-probe.sh` | Ruta completa ya incorpora sprite-RAM, política MMIO, VRAM y soft reset. Conservar contratos y gates nativos originales. |
| `scripts/a063_capture_integrity.py` | `capture_postflight()` rechaza `oracle_mode=True` fuera del directorio mini-smoke; `verify_postflight()` exige identidad binaria específica solo para mini-smoke. Debe aceptar con seguridad el **destino completo exacto**, sin abrir rutas arbitrarias. |
| `scripts/a063_bank_oracle_gate.py` | `evaluate()` usa rutas mini-smoke fijas y su resultado por `compare()` depende de cero resets; ese gate es para **mini**, no vale tal cual para full con reset controlado. Reutilizar validación 1:1; definir política de epoch/soft-reset para full sin degradar requisitos. |
| `scripts/r3_bank_provenance.py` | `run_report()` vincula fingerprint ROM/PC y genera witness privado, pero **no consume/compara obligatoriamente E nativo**. D6 debe exigir coincidencia E ↔ firma en cada prestate y el vínculo al preflight. |
| `scripts/r3-banked-critical-path.sh` | Revalidación offline del workflow **no-oracle**; no debe certificar D6 sin preflight/oracle full. |
| `scripts/r3_banked_static_gate.mjs` | A0.6.4 usa por defecto `out/r2/mame-probe` + `out/r3/banked-provenance`, con gate real sprite boot, reset y hash manifest de la misma captura. No cambiar a mini-smoke, no falsificar la evidencia de dos epochs. |

**Advertencia arquitectónica:** el `compare()` actual de `a063_bank_oracle_gate.py` marca INCONCLUSIVE si observa resets (`native_soft_reset_notifications > 0`). D6 exige el soft reset real para los gates de sprite/video. El agente debe **separar criterios mini/full** y definir comprobación por epochs antes de capturar; no invocar el gate mini sobre la corrida con reset ni quitar el requisito de reset en gates de video/boot.

## 3. Bloque de tareas, dependencias y aceptación

### D6.T0 — Freeze de baseline y contrato de privacidad

- **T0.1** Verificar `git status`, rama, commit, Docker local `colima`, imagen y SHA del binario. Inspeccionar únicamente metadatos agregados de v2 con los volúmenes `:ro`.
- **T0.2** Registrar contrato de inmutabilidad: v1 y v2 **nunca se montan RW** ni se eliminan; D6 usa volumen **nuevo**, sin reutilizar `out/` del host.
- **Aceptación:** entrada D5 PASS documentada y hash del binario coincidente; evidencia protegida.

### D6.T1 — Runner full-oracle y contratos ROM-free (completado ROM-free)

- **T1.1 Captura:** extender el runner completo existente con modo explícito `--oracle` en el preflight; preservar `GNG_R2_TRACE_MODE=printf`, firmas `b@`, prestate nativo y **`gng_a063_bank` en la misma acción/línea de debugger**; asegurar sprite tap, video tap, política MMIO y **un soft reset observado**. No cambiar `main` ni el debugger C++.
- **T1.2 Integridad:** permitir exclusivamente el nuevo destino full `out/r2/mame-probe` en modo oracle mediante opt-in inequívoco; vincular binario, action, fuentes congeladas, postflight y manifest. Rechazar fuentes modificadas, omisiones/duplicados de E, PC/registros no alineados, E >4 y trazas huérfanas.
- **T1.3 Oráculo + provenance:** exigir para **cada** prestate la igualdad 1:1 `E_live == bank_from_authenticated_ROM_pair`; exigir conteos y orden completos, verificación en todas las epochs y al menos una transición verificable post-selector sin inferencias por frame. Mantener el soft reset explícito, separar transiciones por epoch; no interpretar un reset como write. Generar witness/manifest **únicamente en privado** después de PASS; A0.6.4 debe consumir esa misma corrida con señal explícita de full-oracle verificado.
- **T1.4 Tests:** ROM-free unitarios/integración adversarial: trazas completas sintéticas de dos epochs, E alterado, reset sin delimitación, signature corrupta, duplicados, misma PC repetida, hash MAME cambiado, cambio fuente tras preflight, ausencia del tap de sprite y colisiones de artefactos. No atenuar gates previos.
- **Aceptación:** nuevos tests + `TMPDIR=/private/tmp bash scripts/a063-r2b-romfree.sh` PASS real, `git diff --check` PASS; integración full-oracle **ROM-free only**. Versionar cambios **antes** de crear preflight/captura nativos.

### D6.T2 — Nueva captura privada completa (depende de T1 PASS)

- **T2.1 Preflight:** elegir nombre de volumen nuevo e inexistente, por ejemplo `gng-a063-private-capture-arm64-full-d6-v1`; fallar si existe. Montar repositorio y ROM del Mac en lectura, MAME en lectura, `out` del volumen nuevo en escritura. `--network none`, `--pull never`, `--platform linux/arm64`, `SDL_AUDIODRIVER=dummy`, `xvfb-run`; usar `timeout` y log en volumen privado (no terminal).
- **T2.2 Ejecución:** capturar una sola corrida completa con el mismo MAME validado; frames suficientes para demostrar el soft reset, la inicialización sprite, política MMIO, VRAM y una transición bancaría. No asumir que 8 frames son suficientes para todas las coberturas: usar límites del contrato y aceptar `INCONCLUSIVE` si falta.
- **T2.3 Postflight:** verificar hash del binario, fuentes, acción, contadores y artefactos; registrar resultado agregado, conservar parcial si falla. No reusar el volumen para retries.
- **Aceptación:** `MAME_EXIT=0`, pre/postflight íntegro; evidencia completa de esa corrida. La captura sola todavía no certifica A0.6.3.

### D6.T3 — Gates offline de A0.6.3 y A0.6.4 (depende de T2 y same-run)

- **T3.1 A0.6.3:** autenticar 5 bancos ROM por CRC, validar par de `b@` y banco `E` **1:1 para todos los preestados** (no solo los PCs bancados); vincular selector `0x3e00` y post-write; separar epochs de reset; producir witness y SHA manifest en la misma evidencia. No declararlo PASS si no hay cobertura de transición/selector.
- **T3.2 A0.6.4:** ejecutar el gate estático existente con paths exactos de esa corrida, sin copiar otro witness. Exigir sprite byte differential real (dos epochs), MMIO/VRAM según contratos existentes, histogramas banco/PC y hashes; registrar límites de CPU/bus/IRQ/SYNC explícitamente.
- **T3.3 Publicación:** reporte **allowlisted** (booleans/contadores/estados, sin datos sensibles) a la rama feature; no publicar datos privados. Distinguir `A063_FULL_NATIVE_BANK_PROVENANCE_PASS`, `A064_GATE_PASS_WITH_LIMITATIONS`, `INCONCLUSIVE` y `BLOCKED` según gates efectivos; **no inventar** nombres de PASS como salidas del runner si no están implementados.
- **Aceptación:** invariantes integrados y pruebas verificadas; si falla, checkpoint explicativo. Aun con PASS de estos gates, no reclamar equivalencia de bus completo, IRQ/SYNC ni videojuego jugable.

## 4. Política de ejecución/seguridad

- **No ejecutar** `scripts/r3-bank-provenance-capture.sh` sin modificación: carece de oráculo full y usa rutas mutables por defecto.
- **No ejecutar** `bash scripts/r3-banked-critical-path.sh` contra v2 mini para presentar A0.6.3/A0.6.4 como PASS.
- **No ampliar** `a063_bank_oracle_gate.compare()` eliminando la condición de soft reset para hacer pasar una corrida completa; separar el contrato full manteniendo detección por epoch.
- **No regenerar** o recompilar el MAME que ya pasa SHA-256; código parcheado no cambia.
- **No modificar** rutas protegidas, `roms/`, `out/` del host, volúmenes v1/v2, binario, GitHub Actions ni `main`. No `git add -A`, `stash`, `reset --hard`, `volume prune` o borrados.
- Los hashes de `a063_trace_contract.SOURCE_FILES` obligan a congelar cambios y hacer commit **antes** de nueva captura. Los logs y muestras ROM/CPU/PC/TSV, manifests privados y generated JS pertenecen solo a `out/` en Docker.
- Si el agente corre conectado a servicios cloud (GPT/Claude), no transmitir contenido crudo ni valores de ROM/traza; solo resultados agregados saneados. No permitir a herramientas agentes subir secretos en telemetría o commits.

## 5. Checkpoint operativo que debe devolver el agente

Usar siempre una barra de progreso, con **D6.T0 → T1 → T2 → T3**. Trabajar tareas y subtareas con máximo dos niveles.

El checkpoint inicial solicitado fue **D6.T0 PASS + D6.T1 IMPLEMENTED/ROMFREE_PASS**, con lista exacta de commits/archivos, tests y resultados, decisiones de cambios y **un único comando Docker seguro listo para T2**. Ya está entregado en el checkpoint ROM-free. T2/T3 se ejecutaron posteriormente; el bloqueo histórico, la corrección y los resultados efectivos figuran en el cierre nativo. Los criterios de esta sección se conservan como historial de la solicitud inicial.

**Solicitud para handoff:** ver `docs/agents/a063-m5-d6-full-native-prompt.md`.

