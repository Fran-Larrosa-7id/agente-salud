# Manual de Marca Digital — Vertical Salud

**Versión:** 0.1 · Propuesta inicial  
**Marca madre:** 7Ideas  
**Ámbito:** productos, aplicaciones y experiencias digitales de la Vertical Salud

---

## 1. Propósito

Este manual define una base visual y de experiencia compartida para los productos digitales de la **Vertical Salud de 7Ideas**.

El objetivo no es que todas las aplicaciones se vean iguales, sino que compartan una familia reconocible mediante:

- principios visuales;
- jerarquía;
- tipografía;
- color;
- componentes;
- iconografía;
- accesibilidad;
- motion;
- estados semánticos;
- criterios UX.

Puede aplicarse a productos como **Horus, Osiris, Onboarding de pacientes, Portal del paciente, Llamador, Turnos por WhatsApp, asistentes IA** y futuras soluciones.

---

## 2. Arquitectura de marca

```text
7Ideas
│
└── Vertical Salud
    ├── Horus
    ├── Osiris
    ├── Onboarding de pacientes
    ├── Portal del paciente
    ├── Llamador de pacientes
    ├── Turnos por WhatsApp
    └── Nuevas soluciones
```

### 2.1 7Ideas como marca madre

7Ideas conserva su identidad corporativa en:

- presentaciones;
- propuestas;
- documentación;
- materiales comerciales;
- firmas;
- créditos;
- pantallas institucionales.

Sin embargo, la estética corporativa de 7Ideas **no debe trasladarse literalmente a las interfaces de Salud**.

El rojo, amarillo y negro pueden mantenerse en el universo institucional, pero no deberían dominar la experiencia de uso clínica o administrativa.

### 2.2 Vertical Salud

La Vertical Salud funciona como una capa especializada y debe transmitir:

- confianza;
- claridad;
- seguridad;
- estabilidad;
- humanidad;
- precisión;
- tecnología útil;
- calma.

Puede presentarse como:

```text
7Ideas · Vertical Salud
```

```text
Soluciones Digitales · Salud
```

```text
Una solución de 7Ideas
```

### 2.3 Identidad por producto

Cada producto puede tener:

- nombre;
- isotipo;
- acento secundario;
- recursos gráficos propios.

Pero debe respetar:

- tipografía base;
- espaciado;
- sistema de componentes;
- estados;
- accesibilidad;
- iconografía;
- motion;
- comportamiento responsive.

---

## 3. Principio rector

> **La tecnología debe sentirse confiable antes que tecnológica.**

En Salud, la interfaz nunca debe competir con la información clínica, administrativa u operativa.

Prioridades:

1. claridad;
2. orientación;
3. legibilidad;
4. accesibilidad;
5. confianza;
6. reducción de fricción;
7. consistencia.

---

## 4. Principios de diseño

### Calma visual

Preferir:

- fondos claros;
- buen whitespace;
- jerarquía fuerte;
- uso moderado de color;
- sombras discretas;
- bordes suaves.

Evitar:

- fondos negros dominantes;
- rojo decorativo;
- glow;
- neón;
- glassmorphism gratuito;
- degradados intensos;
- exceso de elementos.

### Claridad antes que decoración

Todo elemento debe cumplir una función.

### Accesibilidad como parte de marca

La accesibilidad es parte de la identidad y no una mejora opcional.

### Humanidad sin infantilización

El tono puede ser amable y cercano sin perder profesionalismo.

---

## 5. Relación visual con 7Ideas

### Sí

- firma discreta;
- footer;
- documentación;
- catálogo;
- presentaciones;
- pantalla de acceso.

Ejemplo:

```text
Horus
Gestión Clínica

Una solución de 7Ideas
```

### No

Evitar dentro del producto:

```text
CTA rojo intenso
fondos negros dominantes
decoración amarilla permanente
```

---

## 6. Paleta principal

### Navy base

```css
#102A43
```

Uso:

- títulos;
- navegación;
- botones;
- iconografía;
- headers;
- superficies oscuras puntuales.

### Navy profundo

```css
#081F33
```

Uso:

- hover;
- fondos institucionales;
- alto contraste.

### Teal principal

```css
#0F8B8D
```

Uso:

- acciones;
- links;
- foco;
- progreso;
- navegación activa.

### Teal hover

```css
#087477
```

### Mint suave

```css
#DFF3EF
```

### Celeste suave

```css
#EAF4FA
```

### Background

```css
#F7F9FC
```

### Surface

```css
#FFFFFF
```

### Surface alternate

```css
#F1F5F9
```

### Texto principal

```css
#172033
```

### Texto secundario

```css
#657184
```

### Texto terciario

```css
#8B96A8
```

### Bordes

```css
#DCE4EC
```

---

## 7. Colores semánticos

| Estado | Color |
|---|---|
| Información | `#3478F6` |
| Éxito / confirmado | `#268267` |
| Atención / warning | `#B7791F` |
| Error / crítico | `#B54747` |
| Neutral / inactivo | `#8A94A6` |

### Regla del rojo

El rojo se reserva para:

- errores;
- eliminación;
- cancelaciones;
- riesgo;
- alertas reales.

> Si todo es rojo, nada parece realmente crítico.

---

## 8. Tipografía

### Producto digital

**Inter**

Pesos recomendados:

```text
400 Regular
500 Medium
600 Semibold
700 Bold
```

### Comunicación y presentaciones

**Manrope**

### Escala sugerida

```text
Display       48–56px
H1            36–40px
H2            28–32px
H3            22–24px
H4            18–20px
Body          16px
Body small    14px
Caption       12–13px
```

Evitar:

- titulares gigantes sin función;
- abuso de negrita;
- exceso de uppercase;
- textos UI menores a 14px.

---

## 9. Iconografía

### Librería recomendada

**Lucide Icons**

Escala:

```text
16px → controles compactos
20px → navegación / botones
24px → cards / estados
```

Stroke:

```text
1.75px – 2px
```

Evitar mezclar:

- Font Awesome;
- Material;
- emojis;
- iconos 3D;
- SVGs de estilos distintos.

---

## 10. Grid y spacing

Sistema base:

```text
4px
8px
12px
16px
24px
32px
40px
48px
64px
```

Contenedor desktop:

```text
1200–1280px
```

Mobile:

```text
padding lateral 16–20px
```

---

## 11. Bordes

```text
6px  → controles compactos
8px  → inputs
10px → botones
12px → cards
16px → bloques destacados
```

Evitar border-radius excesivos o arbitrarios.

---

## 12. Elevación

La interfaz debe apoyarse más en:

- contraste;
- bordes;
- fondos;
- whitespace;

que en sombras fuertes.

```css
--shadow-sm: 0 2px 8px rgba(15, 42, 67, 0.05);
--shadow-lg: 0 12px 32px rgba(15, 42, 67, 0.12);
```

---

## 13. Botones

### Primario

```css
background: #102A43;
color: #FFFFFF;
border-radius: 10px;
```

Hover:

```css
background: #081F33;
```

### Primario alternativo

```css
background: #0F8B8D;
```

### Secundario

```css
background: #FFFFFF;
border: 1px solid #DCE4EC;
color: #102A43;
```

### Destructivo

```css
background: #B54747;
color: #FFFFFF;
```

Solo para acciones destructivas reales.

---

## 14. Inputs

Altura recomendada:

```text
44–48px
```

Reglas:

- label visible;
- placeholder como ayuda;
- focus claro;
- error debajo;
- no depender solo del color.

---

## 15. Cards

Estándar:

```text
background blanco
border 1px
radius 12–16px
padding 20–24px
shadow mínima
```

Evitar:

```text
card dentro de card dentro de card
```

si puede resolverse con jerarquía y spacing.

---

## 16. Badges y pills

Usar solo para:

- estados;
- categorías;
- filtros;
- metadata relevante.

No convertir cada dato en una pill.

---

## 17. Formularios

Preferir flujos progresivos.

Ejemplo:

```text
Datos personales
Cobertura
Antecedentes
Documentación
Revisión
```

en lugar de una única pantalla con decenas de campos.

---

## 18. Dashboards

Un dashboard debe responder preguntas concretas.

Ejemplos:

```text
¿Cuántos pacientes esperan?
¿Quién requiere revisión?
¿Qué documentación falta?
¿Qué turno es el próximo?
```

Evitar gráficos que solo decoren.

---

## 19. Tablas

Recomendaciones:

- encabezado claro;
- filas 48–56px;
- estados legibles;
- acciones agrupadas;
- filtros visibles;
- sticky header cuando sea necesario.

En mobile, considerar cards o filas expandibles.

---

## 20. Estados de interfaz

Toda feature debería contemplar:

```text
loading
empty
error
success
disabled
pending
warning
```

Ejemplo:

```text
No hay pacientes esperando
Los nuevos ingresos aparecerán aquí.
```

---

## 21. Fotografía

### Sí

- clínicas reales;
- luz natural;
- tecnología en contexto;
- manos usando dispositivos;
- interacción profesional;
- espacios cuidados.

### No

- médicos mirando cámara con brazos cruzados;
- estetoscopios genéricos;
- stock evidente;
- hospitales futuristas;
- hologramas;
- robots médicos decorativos.

---

## 22. Motion

Duraciones:

```text
Hover              160–220ms
Feedback           160–220ms
Cambio de vista    220–300ms
Drawer / modal     240–320ms
```

Distancia habitual:

```text
8–16px
```

Permitido:

- fade;
- translate sutil;
- progress;
- drawer;
- accordion;
- hover;
- confirmación.

Evitar:

- bounce;
- parallax fuerte;
- loops;
- elementos flotantes permanentes;
- movimiento sin función.

---

## 23. Reduced motion

Todas las aplicaciones deben contemplar:

```css
@media (prefers-reduced-motion: reduce)
```

Reducir o eliminar motion no esencial.

---

## 24. Accesibilidad

Base recomendada:

**WCAG AA**

Contraste:

```text
Texto normal ≥ 4.5:1
Texto grande ≥ 3:1
```

Targets táctiles:

```text
mínimo 44×44px
```

Focus:

- siempre visible;
- nunca eliminar `outline` sin alternativa.

Los estados deben usar:

- color;
- texto;
- icono;

y no solo color.

---

## 25. Responsive

### Mobile

No debe ser desktop reducido.

Priorizar:

- lectura;
- CTA accesible;
- inputs táctiles;
- formularios cortos;
- navegación simple.

### Tablet

Especialmente relevante para:

- recepción;
- consultorio;
- dispositivos compartidos.

### Desktop

Aprovechar el espacio sin estirar artificialmente el contenido.

---

## 26. Identidad por producto

| Producto | Acento sugerido | Sensación |
|---|---|---|
| Horus | Teal | gestión, confianza, precisión |
| Osiris | Azul | análisis, estudios, información |
| Onboarding | Mint / Teal | acompañamiento, progreso |
| Llamador | Sky Blue | orientación, movimiento |
| Portal | Azul / Indigo suave | autoservicio, cercanía |
| Asistente IA | Indigo | análisis, asistencia |
| Triage | Ámbar controlado | atención, prioridad |
| Turnos WhatsApp | Verde mensajería + Navy | conversación, automatización |

Los acentos no reemplazan los colores semánticos.

---

## 27. IA en Salud

La IA debe mostrarse como:

```text
asistente
analista
capa conversacional
capacidad transversal
```

No como autoridad clínica.

### Sí

```text
El asistente consulta las fuentes conectadas.
```

```text
La disponibilidad es validada por el sistema de agenda.
```

### No

```text
La IA sabe cuándo atiende cada médico.
```

```text
La IA determina el diagnóstico.
```

---

## 28. Copy

Debe ser:

- claro;
- breve;
- humano;
- profesional;
- accionable.

### Sí

```text
Falta cargar la orden médica.
```

### No

```text
Se ha detectado que el documento correspondiente a la orden médica aún no se encuentra cargado en el sistema.
```

---

## 29. Tono por audiencia

### Paciente

```text
claro
amable
tranquilizador
```

### Profesional

```text
preciso
operativo
directo
```

### Administración

```text
ordenado
accionable
eficiente
```

---

## 30. Do / Don't

### Do

- usar whitespace;
- mantener jerarquía;
- aplicar teal a acciones;
- reservar rojo;
- mostrar estados claros;
- priorizar accesibilidad;
- simplificar flujos.

### Don't

- UI negra dominante;
- rojo corporativo como CTA médico;
- amarillo decorativo;
- gradients fuertes;
- glassmorphism gratuito;
- exceso de pills;
- sombras profundas;
- loaders decorativos;
- dashboards llenos de gráficos sin función.

---

## 31. Ejemplo de login

```text
[Logo del producto]

Iniciar sesión

Usuario
Contraseña

[Ingresar]

Una solución de 7Ideas
```

El endorsement debe ser secundario.

---

## 32. Ejemplo de dashboard

```text
Sidebar navy
Surface clara
Acción activa teal
Cards blancas
Estados semánticos consistentes
```

---

## 33. Ejemplo mobile paciente

```text
fondo claro
progreso visible
CTA accesible
formularios simples
feedback inmediato
```

---

## 34. Tokens CSS

```css
:root {
  /* Brand */
  --health-primary: #102a43;
  --health-primary-strong: #081f33;
  --health-accent: #0f8b8d;
  --health-accent-hover: #087477;

  /* Surfaces */
  --health-bg: #f7f9fc;
  --health-surface: #ffffff;
  --health-surface-alt: #f1f5f9;

  /* Text */
  --health-text: #172033;
  --health-text-muted: #657184;
  --health-text-subtle: #8b96a8;

  /* Borders */
  --health-border: #dce4ec;

  /* Semantic */
  --health-info: #3478f6;
  --health-success: #268267;
  --health-warning: #b7791f;
  --health-danger: #b54747;
  --health-neutral: #8a94a6;

  /* Soft */
  --health-mint: #dff3ef;
  --health-sky: #eaf4fa;

  /* Radius */
  --health-radius-xs: 6px;
  --health-radius-sm: 8px;
  --health-radius-md: 10px;
  --health-radius-lg: 12px;
  --health-radius-xl: 16px;

  /* Spacing */
  --health-space-1: 4px;
  --health-space-2: 8px;
  --health-space-3: 12px;
  --health-space-4: 16px;
  --health-space-6: 24px;
  --health-space-8: 32px;
  --health-space-10: 40px;
  --health-space-12: 48px;
  --health-space-16: 64px;

  /* Motion */
  --health-motion-fast: 180ms;
  --health-motion-base: 240ms;
  --health-motion-slow: 300ms;

  /* Shadows */
  --health-shadow-sm:
    0 2px 8px rgba(15, 42, 67, 0.05);
  --health-shadow-lg:
    0 12px 32px rgba(15, 42, 67, 0.12);
}
```

---

## 35. Checklist para nuevas features

### Marca

- [ ] respeta la paleta Salud;
- [ ] no usa rojo sin motivo semántico;
- [ ] tipografía consistente;
- [ ] iconografía consistente.

### UX

- [ ] jerarquía clara;
- [ ] acción principal evidente;
- [ ] empty state contemplado;
- [ ] error contemplado;
- [ ] loading contemplado.

### Accesibilidad

- [ ] contraste AA;
- [ ] teclado;
- [ ] focus visible;
- [ ] labels;
- [ ] target táctil;
- [ ] reduced motion.

### Responsive

- [ ] mobile;
- [ ] tablet;
- [ ] desktop.

### Motion

- [ ] aporta valor;
- [ ] duración adecuada;
- [ ] no distrae.

---

## 36. Guía para IA generativa

Cuando Claude, Codex u otra IA implemente una feature, debe evitar:

```text
generic SaaS dashboard
bento grid automático
exceso de gradients
cards con glow
border-radius de 24px en todo
pills por cada dato
iconos decorativos sin función
```

Debe priorizar:

```text
jerarquía
claridad
contexto clínico
accesibilidad
coherencia con el producto
```

---

## 37. Criterio final

Una aplicación de Vertical Salud debe sentirse:

```text
tecnológica
pero no fría

profesional
pero no burocrática

clara
pero no vacía

humana
pero no infantil

moderna
pero no dependiente de tendencias pasajeras
```

---

## 38. Frase guía

> **Tecnología que acompaña la atención, sin competir con ella.**

---

## 39. Estado del documento

Este manual es una **base inicial de diseño**.

Debe validarse con:

- dirección;
- producto;
- desarrollo;
- UX/UI;
- referentes de la Vertical Salud.

Las decisiones específicas de cada producto pueden evolucionar, siempre respetando los principios comunes definidos aquí.
