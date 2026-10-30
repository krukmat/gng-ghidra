# Shell Android local

El módulo `:app` es la plantilla genérica de la base. `settings.gradle.kts` lo incluye desde la copia fijada `base/templates/android/app` (ver `docs/android-shell.md` en la base). Este directorio solo conserva la raíz Gradle, el wrapper y la identidad de GnG.

`gradle.properties` define la identidad. Las propiedades `-P` la reemplazan:

| Propiedad | Valor GnG | Uso |
| --- | --- | --- |
| `SHELL_APP_ID` | `org.gng.offline` | ID del paquete instalado |
| `SHELL_APP_LABEL` | `Ghosts'n Goblins` | Etiqueta visible |
| `SHELL_VERSION_CODE`, `SHELL_VERSION_NAME` | `8`, `0.7.0` | Versión |
| `SHELL_ASSETS_DIR` | `../out/android/assets` | Carpeta local de assets web, relativa a `android/` |

`scripts/ao_build_apk.sh` traduce las variables de entorno `AO_APP_ID`, `AO_APP_LABEL` y `AO_ASSETS_DIR` a esas propiedades.

La actividad es siempre `org.rommigration.shell.MainActivity`, aunque cambie el ID instalado. Los gates Android la lanzan con `AO_APP_ID` como paquete. El registro sale con la etiqueta de logcat `WebShell`. La URL local de `WebViewAssetLoader` es `https://appassets.androidplatform.net/assets/index.html`, y la carpeta debe contener el sitio ya generado.

Los APK y los assets se generan bajo `out/` y son privados.
