# A0.6.3 — Plan M5 Pro con Docker Linux ARM64 (pendiente de ejecutar)

**Fecha:** 2026-10-24  
**Rama aislada:** `feature/a063-r1-forensics-contract`. No modificar `main`, no activar GitHub Actions.  
**Coste incremental permitido:** 0 EUR. Nada de Codespaces, VPS, Docker Build Cloud, máquinas cloud ni suscripciones.

## Decisión

Usar el MacBook Pro M5 Pro (32 GiB RAM) como host para un contenedor **Linux ARM64**, administrado con Docker Engine local. Preferir Colima (VM `vz`, arquitectura `aarch64`) si no existe ya un Docker Desktop gratuito y válido para uso personal.

Esto preserva los gates de compilación Linux (ELF, sha256sum, toolchain Linux) y reduce cambios respecto del runner Codespaces. El binario **no es** el ELF x86_64 de Codespaces ni un ejecutable Mach-O de macOS: es ELF Linux/aarch64. No se deben mezclar hashes o inferir equivalencia binaria entre arquitecturas. El comportamiento específico de A0.6.3 se certificará solo mediante evidencia nativa privada.

MAME documenta builds selectivos: `make SUBTARGET=gnga063 SOURCES=src/mame/capcom/gng.cpp REGENIE=1`; `REGENIE=1` se necesita al configurar/cambiar parámetros de build, no en cada reanudación con configuración congelada.

Fuentes: https://docs.mamedev.org/initialsetup/compilingmame.html ; https://colima.run/docs/configuration/ ; https://docs.docker.com/engine/storage/volumes/

## Lo ya completado (NO repetir como implementación)

- R2.E3: suite ROM-free PASS y replay sintético 17/17.
- Parche aprobado de solo lectura `patches/mame0289-a063-bank-oracle.patch`, aplicado/verificable contra MAME tag `mame0289`, commit upstream `f34f02505e32c1993c6a782b6814232cbfc74e36`.
- R2.E4/R2.E5 **no acreditados**: no existe binario terminado y validado desde Codespaces.
- R2.F / A0.6.3 sigue bloqueado sin oráculo de banco por preinstrucción validado con ROM privada.

## Bloque pendiente y dependencias

### M5.D0 — Preflight del host y control de coste (D0 → D1)

- D0.1 Verificar `arm64`, 32 GiB, macOS compatible, Docker CLI/daemon local o Colima libre (sin activar plan de pago). Preferir herramientas ya instaladas.
- D0.2 Empezar con Colima `--vm-type vz --arch aarch64 --cpus 6 --memory 16 --disk 80` si es necesario crear VM, dejando margen para macOS. Ajustes orientativos, no tiempos prometidos.
- D0.3 Verificar dentro del contenedor `uname -m=aarch64`, arquitectura `linux/arm64`, memoria, espacio útil y toolchain C++20. Bloquear `linux/amd64` por emulación involuntaria.
- Aceptación: contenedor ARM64 nativo, sin cloud, herramientas comprobadas; no se abre ninguna vía de facturación.
- Entregable: preflight agregado, sin datos privados.

### M5.D1 — Imagen de compilación fijada (D0 → D1 → D2)

- D1.1 Crear `Dockerfile` específico basado en Ubuntu 24.04 ARM64 con las dependencias MAME 0.289 equivalentes al devcontainer Linux, sin ROM, credenciales ni fuentes privadas incluidas en la imagen.
- D1.2 Verificar que la imagen base y dependencias admiten ARM64; rechazar fallback `amd64`. Registrar etiqueta/digest del entorno, `c++ --version` y versión del sistema.
- D1.3 Evitar rebuilds de imagen entre intentos salvo cambio de dependencias.
- Aceptación: `docker build --platform linux/arm64` y preflight herramienta PASS.
- Entregable: imagen Docker local y definición reproducible. **No publicada en registro remoto.**

### M5.D2 — Source y caché persistentes (D1 → D2 → D3)

- D2.1 Usar **volumen Docker nombrado** para checkout MAME 0.289 y objetos compilados; no compilar un árbol con miles de ficheros desde un bind mount macOS, para reducir latencia de I/O.
- D2.2 Clonar una vez `mame0289`, comprobar tag/commit exactos, aplicar el parche aprobado una vez; en reintentos verificar la igualdad exacta del parche sin limpiar el árbol.
- D2.3 Montar checkout del repositorio `gng-ghidra` en modo solo lectura para leer scripts y parche; reservar directorio de evidencias local separado. No utilizar `docker volume prune`, `colima delete`, `docker system prune --volumes`, `make clean` ni `git reset --hard` sobre MAME.
- Aceptación: los objetos y el estado del árbol sobreviven a reinicio del contenedor y del runtime.
- Entregable: volumen persistente local más estado de fuente documentado.

### M5.D3 — R2.E4: build incremental y medición (D2 → D3 → D4)

- D3.1 Primer build selectivo `SUBTARGET=gnga063 SOURCES=src/mame/capcom/gng.cpp REGENIE=1`, empezando con `-j4` y 16 GiB VM; degradar a `-j2` si hay OOM. No aumentar recursos ni contratar hardware. Ajustar según memoria observada.
- D3.2 En reanudaciones con **parámetros idénticos**, conservar objetos y evitar `REGENIE=1` salvo necesidad real. Confirmar en prueba de regresión que MAME no recompila por un cambio inadvertido de flags.
- D3.3 Guardar fase, duración, código de salida, `memory.events` si existe y último target sin registrar bytes ROM. Evitar `timeout` arbitrario en local; usar `caffeinate -i` en el host mientras el build real esté activo si macOS amenaza con suspender la máquina (sin tocar sistemas remotos).
- Aceptación: `make exit=0`; si falla, causa técnica diagnóstica y objetos conservados.
- Entregable: ELF Linux/aarch64 compilado y logs locales privados, nunca versionados.

### M5.D4 — R2.E5: gate binario real (D3 → D4 → D5)

- D4.1 Localizar binario real sin asumir nombre/ruta; verificar ELF `e_machine=AArch64`, versión `0.289`, driver `gngb` mediante `-listfull`.
- D4.2 Verificar presencia real de `gng_a063_bank` y reproducibilidad del parche/checkout; computar SHA-256 del binario, parche, entorno y revision.
- D4.3 Adaptar gates Linux de Codespaces sin asumir CPU x86_64 ni macOS Mach-O. **No** declarar A0.6.3 PASS por compilar.
- Aceptación: gate ROM-free completo `R2E_MAC_DOCKER_BINARY_READY`, no certificación nativa.
- Entregable: informe mínimo de hashes, plataforma, driver, símbolo y resultado (sin ROM).

### M5.D5 — R2.F nativo privado (D4 → D5 → D6)

- D5.1 En una ejecución separada, montar `roms/` local como **solo lectura**, el checkout de repo como solo lectura y `out/`/evidencia privada de Mac como persistente con escritura. No copiar ROM a la imagen ni volúmenes publicados, Git ni CI.
- D5.2 Configurar `GNG_R3_MAME_BIN` con ruta exacta al ELF Linux/aarch64 verificado; ejecutar primero `scripts/a063-native-oracle-miniprobe.sh`. El runner debe preservar capturas previas y bloquear colisiones con salidas existentes.
- D5.3 Aceptar solo una relación **1:1** entre preinstrucción, PC, registros, firma de ROM autenticada y banco activo real `m_mainbank->entry()`, incluyendo una transición post-selector. Si la cobertura es incompleta, mantener `INCONCLUSIVE`.
- Aceptación: validación nativa auténtica en datos privados; no subir ROM, CPU trace ni witness.
- Entregable: reporte agregado depurado y evidencia completa local.

### M5.D6 — Desbloqueo de A0.6.3 / A0.6.4 (D5 → D6)

- D6.1 Si mini-oráculo pasa, ejecutar captura completa A0.6.3 bajo condiciones controladas con la misma versión de MAME y registro del manifiesto previo/posterior.
- D6.2 Ejecutar `bash scripts/r3-banked-critical-path.sh` sobre evidencia de **esa** corrida; si es necesario adaptar montajes, no degradar ni suavizar contratos de integridad.
- D6.3 Generar y publicar por GitHub **solo** informe agregado explícitamente allowlisted, mediante comando único con commit+push autorizado. Nunca publicar trazas CPU, ROMs, binarios, directorio `out/` ni tokens.
- Aceptación: gates reales por instrucción y bancados PASS, o bloqueo preciso con evidencia reproducible. Cualquier otro resultado mantiene A0.6.3/A0.6.4 pendientes.
- Entregable: informe de estado del bloque y siguiente dependencia.

## Implementación del workflow (pendiente)

Se deben crear scripts de entrada `scripts/a063-m5-docker.sh {prepare,build,verify,private-probe,report}` y su Dockerfile/Compose (o equivalente), con:
- modo `prepare` sin secretos; `build` sin ROM; `private-probe` opt-in e independiente;
- fail-closed por plataforma, rama, versión, parche o ruta de evidencia distinta;
- mismo comando final para publicar **exclusivamente** JSON/Markdown saneado en rama feature;
- suite sintética nueva para plataforma ARM64 y rechazo de binarios erróneos;
- sin dependencia de Codespaces, sin Github Actions, sin gastos extra.

## Riesgos residuales

1. Primera compilación ARM64 empieza de cero: objetos Codespaces x86_64 no se reutilizan entre arquitecturas.
2. Si la imagen 0.289 o sus dependencias presentan problemas Linux/aarch64, se diagnostica el build en lugar de cambiar a `linux/amd64` de forma silenciosa; emular x86 penalizaría rendimiento.
3. Una VM Docker apagada/suspendida detiene el proceso. Los volúmenes persistentes conservan artefactos si no se destruye la VM. Si hace falta, evitar el reposo del Mac mientras compila.
4. El oráculo instalado en la VM no puede acceder a una ROM privada sin un **montaje local explícito**. Nunca asumir que el éxito ROM-free certifica bancos reales.
5. Tiempo real del build desconocido; medir la primera ejecución en lugar de prometer cifras.
