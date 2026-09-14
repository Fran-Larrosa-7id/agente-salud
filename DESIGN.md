---
name: Onboarding de Pacientes
description: Pre-admisión digital HealthTech — precisión de hoja de laboratorio aplicada a un flujo de paciente y un panel institucional.
colors:
  navy-900: "#0b2545"
  navy-800: "#12305c"
  navy-700: "#1a3d6d"
  navy-500: "#385a86"
  teal-700: "#095f57"
  teal-600: "#0c7f74"
  teal-500: "#0f9b8e"
  teal-100: "#d8f0ec"
  mint-100: "#e3f5f0"
  sky-50: "#f5fafd"
  sky-100: "#eaf3fb"
  white: "#ffffff"
  gray-50: "#f7f9fb"
  gray-100: "#eef2f5"
  gray-200: "#e2e8ed"
  gray-300: "#cdd7de"
  gray-400: "#71808a"
  gray-600: "#5b6b76"
  gray-900: "#1b2734"
  amber-700: "#6e4610"
  amber-600: "#a86a1d"
  amber-100: "#faf0e0"
  red-600: "#b6402f"
  red-100: "#fbe9e6"
  green-700: "#197a52"
  green-100: "#e1f5eb"
typography:
  body:
    fontFamily: "-apple-system, 'Segoe UI', 'Helvetica Neue', Roboto, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "-apple-system, 'Segoe UI', 'Helvetica Neue', Roboto, Arial, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  label:
    fontFamily: "-apple-system, 'Segoe UI', 'Helvetica Neue', Roboto, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    letterSpacing: "0.08em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
  12: "48px"
  16: "64px"
components:
  button-primary:
    backgroundColor: "{colors.navy-900}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "0 24px"
  button-accent:
    backgroundColor: "{colors.teal-600}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "0 24px"
  button-accent-hover:
    backgroundColor: "{colors.teal-700}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.navy-900}"
    rounded: "{rounded.md}"
---

# Design System: Onboarding de Pacientes

## Overview

**Creative North Star: "The Lab Report"**

The system treats every patient as a precise, legible record-in-progress — the visual grammar of a clinical lab result sheet — instead of the generic SaaS dashboard of nested cards and decorative charts. Hairline rules divide fields the way a lab sheet divides result rows; section labels run as small tracked caps; numerals are set with tabular figures so columns of data align like instrument readings; and status is always communicated as icon + word + color together, never color alone. Progress is a named sequence of phases, never a bare percentage.

This precision is warmed, not cooled, by a navy/teal palette, generous whitespace, and soft shadows — the aim is trustworthy and premium, never sterile or bureaucratic.

**Key Characteristics:**
- Hairline dividers instead of nested card-in-card containers.
- Tabular/lining numerals wherever a number appears (DNI, percentages, counts, phone).
- Status never relies on color alone — every badge pairs an icon, a word, and a color.
- Progress reads as named phases ("Datos personales", "Cobertura médica"...), not a bare percent.
- One single accent color (teal) reserved for actionable/live state; navy carries structure and text.

## Colors

Restrained strategy: neutrals and navy carry structure and text; teal is the single accent reserved for primary actions and "live/actionable" state.

### Primary
- **Deep Navy** (`#0b2545`): body ink, headings, primary buttons, dark chrome (top context bar).
- **Teal Accent** (`#0f9b8e` fill / `#0c7f74` text-on-light / `#095f57` hover): the one actionable color — primary CTAs, progress fill, active states, section-label kickers.

### Neutral
- **Page Gray** (`#f7f9fb`): app background.
- **Card White** (`#ffffff`): surfaces, cards, table.
- **Line Gray** (`#e2e8ed` / `#cdd7de`): hairline dividers and input borders — never a heavy box border.
- **Muted Text** (`#5b6b76` / `#71808a`): secondary copy, field hints, timestamps. Both meet 4.5:1 against white and page-gray backgrounds.
- **Ink** (`#1b2734`–`#0b2545`): primary text.

### Status roles (Neutral family, not a rainbow)
- **Success / Completo** — `#197a52` text on `#e1f5eb`.
- **Pending / Pendiente** — `#a86a1d` text on `#faf0e0` (large numerals only; body text uses the darker `#6e4610`).
- **Review / Revisión requerida** — `#b6402f` text on `#fbe9e6`.
- **Neutral / No iniciado** — muted gray text on `#eef2f5`.

### Named Rules
**The Icon-Word-Color Rule.** No status is ever conveyed by color alone; every badge and alert pairs an icon glyph and a text label with its color.

## Typography

**Body/Display Font:** System stack (`-apple-system, Segoe UI, Helvetica Neue, Roboto, Arial, sans-serif`) — a workhorse face chosen deliberately for an Operate surface: it renders instantly with no external request (works in a clinic with no wifi), and its tabular figures give the numeric precision the direction requires.

**Character:** Plain, fast, legible — the typography disappears so the data and the state read first.

### Hierarchy
- **Title** (800, 1.625rem–2rem, 1.2 line-height, -0.01em tracking): screen titles, patient name in drawer.
- **Body** (400, 0.9375rem, 1.5 line-height): form copy, descriptions.
- **Label** (700, 0.75rem, 0.08em tracking, uppercase): section eyebrows ("ANTECEDENTES", "ESTADO DEL ONBOARDING").
- **Numerals**: always `font-variant-numeric: tabular-nums lining-nums` via the `.num` utility class — applied to DNI, phone, dates, percentages, and every StatCard value.

### Named Rules
**The Tabular Numeral Rule.** Any number a user scans down a column (table progress %, DNI, StatCard counts) is set with tabular figures so digits align vertically like an instrument reading.

## Layout

Two distinct spatial models sharing one token system:

- **Patient flow (mobile-first):** single-column `.phone-frame` capped at 480px, one screen visible at a time, sticky bottom CTA, persistent top context bar. Vertical rhythm on an 8px scale (`--sp-*` tokens).
- **Institution dashboard (desktop-first, tablet-responsive):** a 1360px-capped `.main` container; a 4-column StatCard grid collapsing to 2 columns under 900px; a `minmax(0, 1fr) 320px` content grid (patient table + side rail) collapsing to a single column under 1080px. The patient table scrolls horizontally on its own (`min-width: 720px` inside an `overflow-x:auto` wrapper) rather than compressing or wrapping cell text — density is preserved, never crushed.

## Elevation & Depth

Flat-by-default with two discreet shadow steps used only where a surface floats above the page: cards (`--shadow-sm`) and the drawer/toasts (`--shadow-lg`). No glow, no glassmorphism, no multi-layer card-in-card shadows.

### Shadow Vocabulary
- **shadow-sm** (`0 1px 2px rgba(11,37,69,0.06)`): resting cards, StatCards, table panel.
- **shadow-md** (`0 4px 16px rgba(11,37,69,0.08)`): hover state on the demo-selector cards.
- **shadow-lg** (`0 12px 32px rgba(11,37,69,0.12)`): the patient drawer and toast stack — the only elements that visually float above the page.

## Shapes

Soft, restrained radii: `6px` (sm, chips/badges), `10px` (md, buttons/inputs), `14px` (lg, cards/panels/drawer edge is square against the viewport edge by design — a drawer is a slice of the page, not a floating card). Borders are always 1px hairlines in `--line`/`--line-strong`, never a heavy or colored border except on focus (teal focus ring) or state (status alert borders).

## Components

### Buttons
- **Shape:** 10px radius, 48px min-height (comfortable touch target), 600 weight label.
- **Primary** (`btn-primary`): navy fill, white text — used for structural/neutral confirmations.
- **Accent** (`btn-accent`): teal-600 fill (`#0c7f74`) / white text, teal-700 hover — the single color reserved for the primary action per screen (Comenzar, Continuar, Enviar, Solicitar documentación).
- **Secondary / Ghost:** white-with-border and transparent variants for secondary or destructive-adjacent actions.

### Badges (PatientStatus)
- **Style:** pill-free rounded-sm chip, icon + label, background always a tint of the status color, text at the darker/700 step of that color family for AA contrast.
- **States:** Completo (green), Pendiente (amber), Revisión requerida (red), No iniciado (neutral gray).

### Progress
- **Bar:** 8px track (`--gray-200`) with a teal fill. The fill animates via `transform: scaleX()` (not `width`) for compositor-only, non-layout-thrashing motion.
- **Phase rail (StepNavigation companion):** a vertical list of named phases, each a numbered/checked dot connected by a line that fills teal as phases complete — replaces a bare percentage with a legible sequence.

### Cards / Panels
- **Corner:** 14px.
- **Background:** white on page-gray.
- **Shadow:** shadow-sm at rest; no nested card-in-card.
- **Border:** 1px hairline, not a shadow-only edge (keeps the lab-sheet crispness in bright light / print-like contexts).

### Inputs / Fields
- **Style:** 1px hairline border, 10px radius, 48px height, white fill.
- **Focus:** border shifts to teal + a 3px soft teal focus ring (`--focus-ring`), never removed.
- **Error:** border shifts to red-600 with an icon+text error line beneath.

### Drawer (Institution patient detail)
- Slides in from the right, full-bleed to the viewport edge (no rounded corner on that edge — it reads as a slice of the page, not a floating card), `shadow-lg`, 480px max width, full-height sections separated by hairlines.

### FileUploader
- Dashed hairline border, sky-tinted fill, centered icon + label; hover/focus shifts to a solid teal border and mint fill. Simulated upload transitions doc rows from a "Pendiente" badge to a "Cargado" badge plus a toast confirmation.

## Do's and Don'ts

### Do:
- **Do** pair every status indicator with an icon and a word, never color alone (WCAG + the direction's Icon-Word-Color Rule).
- **Do** use tabular numerals (`.num`) for any number a user scans in a column or compares across rows.
- **Do** name progress phases explicitly instead of showing a bare percentage as the only signal.
- **Do** animate progress fills and any width-like change via `transform: scaleX()`/`translate`, not `width`/`height`/`margin`.
- **Do** keep the teal accent reserved for the single primary action or live state per screen.

### Don't:
- **Don't** nest cards inside cards, or add a shadow to every rectangle — hairlines carry structure, shadows are reserved for genuinely floating surfaces (drawer, toasts).
- **Don't** introduce a second accent color; secondary emphasis is navy or a status tint, never a new hue.
- **Don't** stack a small rounded-square icon directly above a heading as a standalone "feature card" tile — set icon and heading inline instead.
- **Don't** use amber-600 (`#a86a1d`) or teal-500 (`#0f9b8e`) as a text color on light fills for body-sized text; use their darker `-700`/`-600` pairing to hold 4.5:1 contrast.
