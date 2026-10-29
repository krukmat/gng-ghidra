# Shell Android local

`app/build.gradle.kts` acepta tres propiedades Gradle:

| Propiedad | Valor GnG por defecto | Uso |
| --- | --- | --- |
| `AO_APP_ID` | `org.gng.offline` | ID del paquete instalado |
| `AO_APP_LABEL` | `Ghosts'n Goblins` | Etiqueta visible |
| `AO_ASSETS_DIR` | `../out/android/assets` | Carpeta local de assets web, relativa a `android/` |

`scripts/ao_build_apk.sh` pasa las variables de entorno con esos nombres a Gradle. La clase del shell permanece en `org.gng.offline.MainActivity`, aunque cambie el ID instalado; `scripts/ao_android_check.mjs` usa `AO_APP_ID` para localizar un paquete alternativo. La URL local de `WebViewAssetLoader` sigue siendo `https://appassets.androidplatform.net/assets/index.html` y la carpeta debe contener el sitio ya generado.

Los APK y assets se generan bajo `out/` y permanecen privados. La parametrización de identidad y empaquetado se comprobó con un APK de prueba y `aapt`; su ejecución en emulador o dispositivo sigue pendiente.
