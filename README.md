# ✦ FRACTURA

> **Rompe el vidrio. Mantén el ritmo.** Un juego tipo *shooter* en primera persona sobre un
> riel infinito: dispara esferas metálicas y haz añicos paneles, anillos, columnas y cristales
> de colores mientras un túnel minimalista fluye hacia ti.

**FRACTURA** toma la esencia de los juegos "rompe-cristal-al-volar" (cristales que se
hacen añicos, regla de oro de no tocar el vidrio, progresión por secciones) y la
reconstruye con identidad propia:

| FRACTURA | En lugar de… |
|---|---|
| Acero reflectante + resplandor de sección | cristal dorado tradicional |
| 6 paletas que respiran: hielo, ámbar, orquídea, esmeralda, rubí, neón | un solo esquema de color |
| Corredor futurista con portales de luz y rejillas | pasillo clásico de galería |
| Munición como esferas sueltas que caen de repisas al romperlas | esferas flotantes estáticas |
| Bonus **¡PERFECTO!** por cruzar anillos sin rozarlos | — |
| Música ambiental generativa (pentatónica, cambia de tonalidad por sección) | banda sonora con licencia |

Todo es **100 % procedural**: geometría, texturas canvas, audio WebAudio y UI. No hay
ningún asset externo ni binario.

## 🎮 Cómo se juega

- **Apuntar** — arrastra el dedo (o el ratón) para mover la mira.
- **Disparar** — mantén pulsado: la esfera sale sola, en ráfaga (o `ESPACIO` en teclado).
- **Romper** — el vidrio se hace añicos; cada sección cambia de color al avanzar.
- **Puntuar** — cada rotura suma; encadena roturas para el multiplicador de combo.
- **Recargar** — rompe las repisas de cristal: las esferas caen y puedes atraparlas.
- **No toques el vidrio** — si chocas con un panel, anillo o cristal pierdes una vida.
- **¡PERFECTO!** — pasa por el centro de un anillo sin tocarlo para un bonus extra.

## 🚀 Ejecutar

```bash
npm install
npm run dev      # desarrollo → http://localhost:5173
npm run build    # compilar para producción → dist/
npm run preview  # servir la build
```

Parámetros útiles:

- `?start=800` — empieza la partida en el metro 800 (para saltar a otra paleta).

## 🧩 Estructura

```
index.html        HUD, menús, estilos
src/main.js       motor 3D, físicas, partículas, spawner, bucle de juego
src/themes.js     paletas de color + escala pentatónica
src/audio.js      SFX y música procedural con WebAudio
test/*.mjs        pruebas automatizadas (Playwright)
```

Construido con [three.js](https://threejs.org) y Vite.

## ⚖️ Legal

Código propio, arte procedural y música generativa propia. No se reproduce ningún
asset de Smash Hit (Mediocre AB) ni de terceros. Inspiración en la mecánica general
del género, no una copia.
