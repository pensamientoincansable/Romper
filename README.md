# ✦ FRACTURA

> **Rompe el vidrio. Mantén el ritmo.** Un juego en primera persona sobre un riel
> infinito: lanzas esferas metálicas con un **tirachinas** y haces añicos paneles,
> anillos, columnas y cristales que son **espejos** mientras un túnel minimalista
> fluye hacia ti.

**FRACTURA** toma la esencia de los juegos "rompe-cristal-al-volar" (cristales que se
hacen añicos, regla de oro de no tocar el vidrio, progresión por secciones) y la
reconstruye con identidad propia:

| FRACTURA | En lugar de… |
|---|---|
| Tirachinas con disparo por toque preciso y arco balístico | apuntado arrastrando |
| Cristales que son espejos pulidos (reflejan tu tirachinas) | cristal dorado tradicional |
| 6 paletas que respiran: hielo, ámbar, orquídea, esmeralda, rubí, neón | un solo esquema de color |
| Corredor futurista con portales de luz y rejillas | pasillo clásico de galería |
| Cada rotura devuelve esferas: cuanto más pequeño el objetivo, más te da | esferas flotantes estáticas |
| Progresión suave: los objetivos encogen poco a poco y la velocidad aumenta | — |
| Ajustes de volumen, calidad de gráficos y **modo seguro (epilepsia)** | — |
| Bonus **¡PERFECTO!** (+2 esferas) por cruzar anillos sin rozarlos | — |
| Música ambiental generativa (pentatónica, cambia de tonalidad por sección) | banda sonora con licencia |

Todo es **100 % procedural**: geometría, texturas canvas, audio WebAudio y UI. No hay
ningún asset externo ni binario.

## 🎮 Cómo se juega

- **Apuntar** — toca o haz clic en el punto exacto al que quieres disparar (sin arrastrar).
- **Disparar** — la esfera sale del tirachinas y cae en arco hasta el punto tocado;
  mantén pulsado para repetir el disparo (o `ESPACIO` en teclado). Una guía tenue muestra
  el arco antes de soltar.
- **Romper** — el vidrio se hace añicos; los cristales son espejos que reflejan tu tirachinas.
- **Esferas** — cada rotura devuelve esferas: cuanto más pequeño y difícil es el objetivo,
  más esferas otorga. Romper es la forma de seguir disparando.
- **Puntuar** — cada rotura suma; encadena roturas para el multiplicador de combo.
- **No toques el vidrio** — si chocas con un panel, anillo o cristal pierdes una vida.
- **¡PERFECTO!** — pasa por el centro de un anillo sin tocarlo para un bonus de +2 esferas.
- **Progresión** — a medida que avanzas los objetivos se encogen muy poco a poco y la
  velocidad de avance aumenta: siempre desafiante, nunca imposible.

## ⚙️ Ajustes (⚙ en partida, en pausa o en el menú)

- **Volumen / Música / Efectos** — tres deslizadores independientes.
- **Calidad de gráficos** — Baja / Media / Alta (resolución, resplandor y partículas).
- **Modo seguro (epilepsia)** — suprime los destellos rojos, apaga el resplandor (bloom)
  y reduce las partículas para jugar sin estímulos estroboscópicos. Activado por defecto.

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
